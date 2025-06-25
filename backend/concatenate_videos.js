import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { exec } from "child_process";
import { createWriteStream, readFileSync, readdirSync, unlinkSync, promises as fs } from "fs";
import { Readable } from "stream";
import { promisify } from "util";

const execAsync = promisify(exec);

// Path to ffmpeg binary, assuming it's in a layer at /opt/bin/
const FFMPEG_PATH = "/opt/bin/ffmpeg"; 
const TMP_DIR = "/tmp";

export const handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    const bucketName = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || 'us-east-1';

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    // Robustly determine the HTTP method for API Gateway v1 or v2
    const httpMethod = (event.requestContext && event.requestContext.http) 
        ? event.requestContext.http.method 
        : event.httpMethod;

    console.log("Determined HTTP Method:", httpMethod);

    if (httpMethod === 'OPTIONS') {
        console.log("Responding to OPTIONS preflight request.");
        return { statusCode: 204, headers, body: '' };
    }

    if (!bucketName) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'S3_BUCKET_NAME not set.' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { uploadSessionId, folderName, gameName } = body;

        if (!uploadSessionId || !folderName || !gameName) {
            throw new Error("Missing 'uploadSessionId', 'folderName', or 'gameName' in request body");
        }

        const s3Client = new S3Client({ region });
        const tmpPrefix = `tmp-uploads/${uploadSessionId}/`;
        const partPaths = [];
        const fileListPath = `${TMP_DIR}/filelist.txt`;
        let outputVideoPath = ''; // Define here to be accessible in finally

        try {
            // 1. List and download all parts from S3
            console.log(`Listing objects with prefix: ${tmpPrefix}`);
            const listCommand = new ListObjectsV2Command({ Bucket: bucketName, Prefix: tmpPrefix });
            const listedObjects = await s3Client.send(listCommand);

            if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
                throw new Error("No video parts found to concatenate.");
            }

            for (const object of listedObjects.Contents) {
                const fileName = `${TMP_DIR}/${object.Key.split('/').pop()}`;
                console.log(`Downloading ${object.Key} to ${fileName}`);
                const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: object.Key });
                const { Body } = await s3Client.send(getCommand);
                await streamToFile(Body, fileName);
                partPaths.push(fileName);
            }

            // Sort parts numerically to ensure correct order
            partPaths.sort();

            // 2. Create filelist.txt for ffmpeg
            const fileListContent = partPaths.map(p => `file '${p}'`).join('\n');
            await fs.writeFile(fileListPath, fileListContent);

            // 3. Execute ffmpeg to concatenate
            const finalVideoName = `${gameName}.mp4`; // Always use .mp4 for compatibility
            outputVideoPath = `${TMP_DIR}/${finalVideoName}`; // Assign value

            console.log("Starting ffmpeg concatenation...");
            const ffmpegCommand = `${FFMPEG_PATH} -f concat -safe 0 -i ${fileListPath} -map 0:v -map 0:a -c copy ${outputVideoPath}`;
            
            await execAsync(ffmpegCommand);
            console.log("ffmpeg process completed.");
            
            // 4. Upload the final video
            const finalVideoKey = `${folderName}/Game Video/${finalVideoName}`;
            console.log(`Uploading final video to ${finalVideoKey}`);
            const putCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: finalVideoKey,
                Body: readFileSync(outputVideoPath),
            });
            await s3Client.send(putCommand);

            // 5. Clean up temporary files from S3
            console.log("Cleaning up temporary S3 objects...");
            const deleteParams = {
                Bucket: bucketName,
                Delete: { Objects: listedObjects.Contents.map(o => ({ Key: o.Key })) },
            };
            await s3Client.send(new DeleteObjectsCommand(deleteParams));
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    message: "Concatenation successful!", 
                    finalVideoKey,
                    bucket: bucketName,
                    folder: folderName,
                    region: region
                }),
            };
        } finally {
            // 6. GUARANTEED: Clean up local /tmp files
            console.log("Running final cleanup of /tmp directory...");
            partPaths.forEach(p => {
                try { unlinkSync(p); } catch (e) { console.warn(`Could not delete ${p}: ${e.message}`); }
            });
            try { unlinkSync(fileListPath); } catch (e) { console.warn(`Could not delete ${fileListPath}: ${e.message}`); }
            if (outputVideoPath) {
                try { unlinkSync(outputVideoPath); } catch (e) { console.warn(`Could not delete ${outputVideoPath}: ${e.message}`); }
            }
            console.log("Local cleanup complete.");
        }
    } catch (error) {
        console.error("--- ERROR ---", error);
        // The detailed error from the try block is caught here
        const errorMessage = error.stderr || error.message;
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Process failed: ${errorMessage}` }),
        };
    }
};

// Helper to stream S3 object body to a local file
function streamToFile(stream, filePath) {
    return new Promise((resolve, reject) => {
        const writeStream = createWriteStream(filePath);
        stream.pipe(writeStream);
        stream.on('error', reject);
        writeStream.on('finish', resolve);
    });
} 