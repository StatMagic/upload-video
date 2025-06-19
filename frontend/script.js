// PLEASE CONFIGURE THIS WITH THE URL OF YOUR API GATEWAY ENDPOINT
const API_GATEWAY_URL = "https://quf9mii5ia.execute-api.ap-south-1.amazonaws.com/default/uploadVideo";

// DOM elements
const gameNameInput = document.getElementById("gameName");
const folderNameInput = document.getElementById("folderName");
const zipFileInput = document.getElementById("zipFile");
const videoFileInput = document.getElementById("videoFile");
const uploadButton = document.getElementById("uploadButton");
const zipProgress = document.getElementById("zip-progress");
const videoProgress = document.getElementById("video-progress");

// Function to generate and set the folder name based on game name
const updateFolderName = () => {
    const today = new Date();
    const dateString = today.toISOString().split("T")[0]; // YYYY-MM-DD
    const gameName = gameNameInput.value.trim();

    if (gameName) {
        // Sanitize gameName for use in a folder name: replace spaces with hyphens, remove invalid characters
        const sanitizedGameName = gameName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        folderNameInput.value = `${dateString}-${sanitizedGameName}`;
    } else {
        // Default value when game name is empty
        folderNameInput.value = `${dateString}-your-game-name`;
    }
};

// Set the initial folder name and update it whenever the game name changes
window.onload = updateFolderName;
gameNameInput.addEventListener('input', updateFolderName);

// Upload button event listener
uploadButton.addEventListener("click", async () => {
    const gameName = gameNameInput.value.trim();
    const folderName = folderNameInput.value;
    const zipFile = zipFileInput.files[0];
    const videoFile = videoFileInput.files[0];

    if (!gameName) {
        alert("Please enter a game name.");
        return;
    }
    if (!zipFile) {
        alert("Please select a zip file.");
        return;
    }
    if (!videoFile) {
        alert("Please select a video file.");
        return;
    }
    if (!API_GATEWAY_URL || API_GATEWAY_URL === "YOUR_API_GATEWAY_URL") {
        alert("Please configure the API_GATEWAY_URL in script.js");
        return;
    }

    // Disable button during upload
    uploadButton.disabled = true;
    uploadButton.textContent = "Getting upload URLs...";

    try {
        // 1. Get pre-signed URLs from our Lambda function
        const response = await fetch(API_GATEWAY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                gameName: gameName,
                folderName: folderName,
                zipFileType: zipFile.type,
                videoFileType: videoFile.type
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const { zipUploadUrl, videoUploadUrl } = await response.json();
        uploadButton.textContent = "Uploading...";

        // 2. Upload files concurrently using the pre-signed URLs
        const zipUploadPromise = uploadFile(zipFile, zipUploadUrl, zipProgress);
        const videoUploadPromise = uploadFile(videoFile, videoUploadUrl, videoProgress);

        await Promise.all([zipUploadPromise, videoUploadPromise]);

        uploadButton.textContent = "Done!";

    } catch (err) {
        console.error("Upload process failed:", err);
        alert(`Upload process failed: ${err.message}`);
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload";
    }
});

const uploadFile = (file, url, progressElement) => {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader('Content-Type', file.type);

        const statusElement = progressElement.querySelector(".status");
        const progressBarInner = progressElement.querySelector(".progress-bar-inner");

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentUploaded = Math.round((event.loaded / event.total) * 100);
                progressBarInner.style.width = `${percentUploaded}%`;
                statusElement.textContent = `In progress... ${percentUploaded}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                statusElement.textContent = "Completed";
                statusElement.style.color = "green";
                resolve(xhr.response);
            } else {
                statusElement.textContent = `Error: Upload failed (status ${xhr.status})`;
                statusElement.style.color = "red";
                reject(new Error(`Upload failed with status: ${xhr.status} - ${xhr.statusText}`));
            }
        };

        xhr.onerror = () => {
            statusElement.textContent = "Error: Network error during upload.";
            statusElement.style.color = "red";
            reject(new Error("Network error during upload."));
        };

        statusElement.textContent = "In progress...";
        progressBarInner.style.width = "0%";
        xhr.send(file);
    });
}; 