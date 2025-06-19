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
        const { gameName, folderName, zipFileType = 'application/zip', videoFileType = 'video/mp4' } = body;

        if (!gameName || !folderName) {
            throw new Error("Missing 'gameName' or 'folderName' in request body");
        }

        const s3Client = new S3Client({ region });

        // Define S3 keys
        const zipKey = `${folderName}/${gameName}.zip`;
        const videoExtension = videoFileType.split('/')[1] || 'mp4';
        const videoKey = `${folderName}/${gameName}.${videoExtension}`;
        console.log(`Generating URLs for keys: ${zipKey}, ${videoKey}`);

        // Create commands for the S3 client
        const zipCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: zipKey,
            ContentType: zipFileType,
        });
        const videoCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: videoKey,
            ContentType: videoFileType,
        });

        // Generate pre-signed URLs
        const [zipUploadUrl, videoUploadUrl] = await Promise.all([
            getSignedUrl(s3Client, zipCommand, { expiresIn: 3600 }),
            getSignedUrl(s3Client, videoCommand, { expiresIn: 3600 })
        ]);
        
        console.log("Successfully generated pre-signed URLs.");
        const responseBody = { zipUploadUrl, zipKey, videoUploadUrl, videoKey };

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