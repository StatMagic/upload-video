# S3 Direct File Uploader (Secure Version)

This is a client-side web application that allows you to upload a zip file and a large video file directly to an Amazon S3 bucket using a secure, serverless backend to authorize uploads.

## Architecture

This application uses a serverless backend powered by **AWS Lambda** and **API Gateway** to generate temporary, pre-signed S3 URLs. This is the recommended secure way to handle uploads from a browser, as your AWS credentials are never exposed to the public.

1.  The browser client asks the API Gateway for permission to upload.
2.  API Gateway triggers the Lambda function.
3.  The Lambda function generates secure, short-lived pre-signed URLs for uploading files.
4.  The browser uses these URLs to upload the files directly to S3.

## How to Deploy and Use

### Step 1: Create an IAM Role for Lambda

Your Lambda function needs permission to write objects to your S3 bucket.

1.  Go to the **IAM** service in the AWS Management Console.
2.  Go to **Roles** and click **Create role**.
3.  For "Trusted entity type", select **AWS service**.
4.  For "Use case", select **Lambda**, then click **Next**.
5.  On the "Add permissions" page, click **Create policy**.
6.  In the policy editor, click the **JSON** tab and paste the following policy. **Remember to replace `YOUR_S3_BUCKET_NAME` with your actual bucket name.**

    ```json
    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowS3PutObject",
                "Effect": "Allow",
                "Action": "s3:PutObject",
                "Resource": "arn:aws:s3:::YOUR_S3_BUCKET_NAME/*"
            },
            {
                "Sid": "AllowLogging",
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "arn:aws:logs:*:*:*"
            }
        ]
    }
    ```
7.  Click **Next: Tags**, then **Next: Review**.
8.  Give the policy a name (e.g., `S3UploadLambdaPolicy`), and click **Create policy**.
9.  Go back to the "Create role" browser tab, refresh the policies list, and search for the policy you just created. Select it and click **Next**.
10. Give the role a name (e.g., `S3UploadLambdaRole`), and click **Create role**.

### Step 2: Create the Lambda Function

1.  Go to the **Lambda** service in the AWS Management Console.
2.  Click **Create function**.
3.  Select **Author from scratch**.
4.  **Function name:** `generateS3PresignedUrls`
5.  **Runtime:** **Node.js 18.x** (or a newer Node.js version).
6.  **Architecture:** `x86_64`
7.  **Permissions:** Expand "Change default execution role", select **Use an existing role**, and choose the `S3UploadLambdaRole` you created in the previous step.
8.  Click **Create function**.
9.  In the function's "Code source" editor, which defaults to `index.mjs` or `index.js`, replace the default code with the entire contents of the `lambda_function.js` file from this repository.
10. Go to the **Configuration** tab, then **Environment variables**.
11. Add the following environment variables:
    *   `S3_BUCKET_NAME`: The name of your S3 bucket.
    *   `AWS_REGION`: The AWS region of your bucket (e.g., `us-east-1`).
12. Click **Deploy** to save your changes.

### Step 3: Create an API Gateway Trigger

1.  In your Lambda function's page, click **Add trigger**.
2.  Select **API Gateway** from the list.
3.  Choose **Create a new API**.
4.  **API type:** **HTTP API**
5.  **Security:** **Open**
6.  Click **Add**.
7.  After the API is created, the **API endpoint** URL will be displayed. Copy this URL.

### Step 4: Configure S3 Bucket CORS Policy

Your S3 bucket must allow the `PUT` requests that will come from the browser.

1.  Go to your S3 bucket in the AWS Management Console.
2.  Click on the **Permissions** tab.
3.  Scroll down to "Cross-origin resource sharing (CORS)" and click **Edit**.
4.  Paste the following JSON policy. **For a production environment, you should restrict `AllowedOrigins` to your actual website's domain instead of `*`.**

    ```json
    [
        {
            "AllowedHeaders": [
                "*"
            ],
            "AllowedMethods": [
                "PUT"
            ],
            "AllowedOrigins": [
                "*"
            ],
            "ExposeHeaders": []
        }
    ]
    ```
5.  Click **Save changes**.

### Step 5: Configure and Run the Web App

1.  Open the `frontend/script.js` file.
2.  Paste the **API endpoint URL** you copied from the `generateS3PresignedUrls` function (Step 3) into the `API_GATEWAY_URL` constant.
3.  Later, you will paste the URL from the concatenation function (Step 6) into the `CONCATENATE_API_URL` constant.
4.  Open the `index.html` file in your web browser. You can now select files and upload them securely.

### Step 6: Deploy the Concatenation Function (for Multi-Video)

If you want to use the multi-video concatenation feature, you must deploy a second Lambda function that handles the video processing.

**Part A: Create an FFmpeg Lambda Layer**

The concatenation function depends on FFmpeg, which is not included in the Lambda environment. You must provide it in a Lambda Layer.

1.  **Download a static FFmpeg build.** A reliable source is [johnvansickle.com](https://johnvansickle.com/ffmpeg/). Download the latest `ffmpeg-release-amd64-static.tar.xz` file.
2.  **Extract the binary.** Un-archive the downloaded file. You are looking for the `ffmpeg` file inside.
3.  **Create the zip structure.** Create a new folder named `bin`. Move the `ffmpeg` binary inside this `bin` folder.
4.  **Zip the layer.** Zip the `bin` folder. The resulting `ffmpeg-layer.zip` file should contain `bin/ffmpeg`, not any other parent folders.
5.  **Create the Lambda Layer.**
    *   In the AWS Lambda console, go to **Layers** and click **Create layer**.
    *   **Name:** `ffmpeg-static`
    *   **Description:** A static build of FFmpeg for video processing.
    *   Upload your `ffmpeg-layer.zip` file.
    *   **Compatible runtimes:** Select **Node.js 18.x**.
    *   Click **Create**.

**Part B: Update the IAM Role**

Your Lambda functions need more permissions to handle the temporary files for concatenation.

1.  Go to the **IAM** service > **Roles** and find the `S3UploadLambdaRole` you created earlier.
2.  Click **Add permissions** > **Attach policies**. Find the policy you created (`S3UploadLambdaPolicy`) and click on it to edit it.
3.  Click **Edit policy** and select the **JSON** tab. Replace the existing policy with the following, which adds permissions to list, get, and delete objects. **Remember to replace `YOUR_S3_BUCKET_NAME`**.

    ```json
    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowS3ReadWrite",
                "Effect": "Allow",
                "Action": [
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:DeleteObject"
                ],
                "Resource": [
                    "arn:aws:s3:::YOUR_S3_BUCKET_NAME/*",
                    "arn:aws:s3:::YOUR_S3_BUCKET_NAME"
                ]
            },
            {
                "Sid": "AllowLogging",
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "arn:aws:logs:*:*:*"
            }
        ]
    }
    ```
4.  Click **Review policy** and **Save changes**.

**Part C: Create the Concatenation Lambda Function**

1.  Go back to the **Lambda** service and click **Create function**.
2.  Select **Author from scratch**.
3.  **Function name:** `concatenateVideos`
4.  **Runtime:** **Node.js 18.x**
5.  **Permissions:** Use the existing `S3UploadLambdaRole`.
6.  Click **Create function**.
7.  Replace the default `index.js` code with the contents of `backend/concatenate_videos.js`.
8.  **Add the FFmpeg Layer:** At the bottom of the page, in the **Layers** section, click **Add a layer**. Select **Custom layers**, choose the `ffmpeg-static` layer you created, and select the latest version. Click **Add**.
9.  **Increase Timeout:** Video processing can be slow. Go to the **Configuration** > **General configuration** tab and click **Edit**. Increase the **Timeout** to at least **5 minutes** (or more for very large videos).
10. **Increase Storage:** While in the "General configuration" settings, increase the **Ephemeral storage (tmp)** from the default 512 MB to at least **2048 MB** (2 GB) or more, depending on the expected size of your combined videos. You can allocate up to 10,240 MB.
11. Add the same **Environment variables** as the first function: `S3_BUCKET_NAME` and `AWS_REGION`.
12. **Deploy** your changes.

**Part D: Create the API Gateway Trigger**

1.  Just as you did in Step 3, add an **API Gateway** trigger for the `concatenateVideos` function.
2.  Once created, copy the new **API endpoint URL**.
3.  Go back to `frontend/script.js` and paste this new URL into the `CONCATENATE_API_URL` constant.

You are now fully deployed!

## Troubleshooting

The most common issue you might face is a **CORS error** in your browser's console. This almost always means your Lambda function is not sending back the correct headers, usually because it encountered an error.

**How to Check Lambda Logs:**

1.  Go to the **Lambda** service in the AWS Management Console and select your function (`generateS3PresignedUrls`).
2.  Click on the **Monitor** tab.
3.  Click the **View CloudWatch logs** button. This will take you to the log group for your function.
4.  Click on the most recent **Log Stream** in the list.
5.  Now, try to upload a file from the web app again. You should see new log entries appear in real-time. Look for any messages in red or any lines that say `ERROR`. These logs will tell you exactly what went wrong inside the Lambda function.

## How it Works

*   The application uses the AWS SDK for JavaScript (v3) to communicate with S3 directly from the browser.
*   It uses S3's multipart upload feature to upload large files in smaller chunks, which is more reliable for large files.
*   The folder name for the uploads is generated automatically based on the current date and a unique identifier.
*   The game name is used as the base name for the uploaded files, and a unique ID is appended to prevent overwrites if a single file is uploaded.
*   For multiple videos, parts are uploaded to a temporary folder and then concatenated on the server into a final video.
*   The upload progress is displayed for each file. 