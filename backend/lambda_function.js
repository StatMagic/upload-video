import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const handler = async (event) => {
    // --- Aggressive Logging for Debugging ---
    console.log("--- LAMBDA INVOCATION START ---");
    console.log("Received event:", JSON.stringify(event, null, 2));

    // Get bucket name and region from environment variables
    const bucketName = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || 'us-east-1';

    // CORS headers for all responses.
    // Making AllowedHeaders more permissive.
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*", // More permissive
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    
    // Robustly determine the HTTP method
    const httpMethod = (event.requestContext && event.requestContext.http) 
        ? event.requestContext.http.method 
        : event.httpMethod;

    console.log("Determined HTTP Method:", httpMethod);

    // Handle preflight CORS OPTIONS request
    if (httpMethod === 'OPTIONS') {
        console.log("Responding to OPTIONS preflight request.");
        return {
            statusCode: 204, // Use 204 for OPTIONS preflight
            headers,
            body: '',
        };
    }

    if (!bucketName) {
        console.error("S3_BUCKET_NAME environment variable not set.");
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'S3_BUCKET_NAME environment variable not set.' }),
        };
    }

    // Parse request body
    try {
        const body = JSON.parse(event.body || '{}');
        console.log("Parsed request body:", body);
        const { gameName, folderName, zipFileType, videos } = body;

        if (!gameName || !folderName) {
            throw new Error("Missing 'gameName' or 'folderName' in request body");
        }

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            throw new Error("Missing 'videos' array in request body");
        }

        const s3Client = new S3Client({ region });
        const responseBody = {};
        const uploadSessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        responseBody.uploadSessionId = uploadSessionId;

        // Add bucket, folder, and region to the response
        responseBody.bucket = bucketName;
        responseBody.folder = folderName;
        responseBody.region = region;

        // --- Video URL Generation ---
        const videoUploadUrlPromises = videos.map((video, index) => {
            const videoExtension = video.videoFileType.split('/')[1] || 'mp4';
            let videoKey;

            // If there's only one video, put it in the final destination.
            // Otherwise, put parts in a temporary directory for concatenation.
            if (videos.length === 1) {
                videoKey = `${folderName}/Game Video/${gameName}.${videoExtension}`;
            } else {
                videoKey = `tmp-uploads/${uploadSessionId}/part-${index + 1}.${videoExtension}`;
            }

            const videoCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: videoKey,
                ContentType: video.videoFileType,
            });
            return getSignedUrl(s3Client, videoCommand, { expiresIn: 3600 });
        });
        
        responseBody.videoUploadUrls = await Promise.all(videoUploadUrlPromises);

        // --- Zip URL Generation (Conditional) ---
        if (zipFileType) {
            const zipKey = `${folderName}/Zip File/${gameName}.zip`;
            responseBody.zipKey = zipKey;
            const zipCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: zipKey,
                ContentType: zipFileType,
            });
            responseBody.zipUploadUrl = await getSignedUrl(s3Client, zipCommand, { expiresIn: 3600 });
        }

        console.log("Successfully generated pre-signed URLs:", responseBody);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(responseBody),
        };

    } catch (error) {
        console.error("--- ERROR ---", error);
        return {
            statusCode: error.message.includes("Missing") ? 400 : 500,
            headers,
            body: JSON.stringify({ error: `Could not process request: ${error.message}` }),
        };
    }
}; 