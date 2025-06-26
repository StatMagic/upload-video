import {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    PutObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION;

const s3Client = new S3Client({ region: REGION });

const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
    console.log("--- LAMBDA INVOCATION START ---");
    console.log("Received event:", JSON.stringify(event, null, 2));

    // Handle preflight CORS request
    if (event.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (!BUCKET_NAME) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'S3_BUCKET_NAME environment variable not set.' }),
        };
    }
    
    try {
        const body = JSON.parse(event.body || '{}');
        const { action, key, uploadId, partCount, parts } = body;

        let response;
        switch (action) {
            case 'create-multipart-upload':
                response = await createMultipartUpload(key);
                break;
            case 'get-presigned-part-urls':
                response = await getPresignedPartUrls(key, uploadId, partCount);
                break;
            case 'complete-multipart-upload':
                response = await completeMultipartUpload(key, uploadId, parts);
                break;
            case 'abort-multipart-upload':
                response = await abortMultipartUpload(key, uploadId);
                break;
            case 'get-presigned-put-url':
                response = await getPresignedPutUrl(key);
                break;
            default:
                throw new Error(`Unsupported action: ${action}`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response),
        };

    } catch (error) {
        console.error("--- ERROR ---", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Could not process request: ${error.message}` }),
        };
    }
};

async function createMultipartUpload(key) {
    if (!key) throw new Error("'key' is required.");
    const command = new CreateMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: key });
    const { UploadId } = await s3Client.send(command);
    return { uploadId: UploadId };
}

async function getPresignedPartUrls(key, uploadId, partCount) {
    if (!key || !uploadId || !partCount) throw new Error("'key', 'uploadId', and 'partCount' are required.");

    const urls = [];
    for (let i = 1; i <= partCount; i++) {
        const command = new UploadPartCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            PartNumber: i,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        urls.push(url);
    }
    return { urls };
}

async function completeMultipartUpload(key, uploadId, parts) {
    if (!key || !uploadId || !parts) throw new Error("'key', 'uploadId', and 'parts' are required.");
    const command = new CompleteMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
    });
    const result = await s3Client.send(command);
    return { result };
}

async function abortMultipartUpload(key, uploadId) {
    if (!key || !uploadId) throw new Error("'key' and 'uploadId' are required.");
    const command = new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
    });
    const result = await s3Client.send(command);
    return { result };
}

async function finalizeUpload(sourceKey, destinationKey) {
    if (!sourceKey || !destinationKey) throw new Error("'sourceKey' and 'destinationKey' are required.");

    try {
        // Copy the object to the new location
        const copyCommand = new CopyObjectCommand({
            Bucket: BUCKET_NAME,
            CopySource: `${BUCKET_NAME}/${sourceKey}`,
            Key: destinationKey,
        });
        await s3Client.send(copyCommand);
        console.log(`Successfully copied ${sourceKey} to ${destinationKey}`);

        // Delete the original object
        const deleteCommand = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: sourceKey,
        });
        await s3Client.send(deleteCommand);
        console.log(`Successfully deleted original object ${sourceKey}`);

        return { message: `File moved to ${destinationKey}` };

    } catch (error) {
        if (error.name === 'AccessDenied') {
            console.error("IAM Role missing s3:CopyObject or s3:DeleteObject permission.");
            throw new Error("Permissions error: The Lambda function's IAM role is missing s3:CopyObject and/or s3:DeleteObject permissions. Please update the policy.");
        }
        throw error;
    }
}

async function getPresignedPutUrl(key) {
    if (!key) throw new Error("'key' is required.");
    const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url };
} 