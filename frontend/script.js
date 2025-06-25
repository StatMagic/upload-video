// PLEASE CONFIGURE THIS WITH THE URL OF YOUR API GATEWAY ENDPOINT
const API_GATEWAY_URL = "https://quf9mii5ia.execute-api.ap-south-1.amazonaws.com/default/uploadVideo";
const CONCATENATE_API_URL = "https://tw60zlvgf3.execute-api.ap-south-1.amazonaws.com/default/concatenateVideos"; // <-- NEW: CONFIGURE THIS

// --- STATE ---
let videoFiles = []; // Array to hold File objects for the multi-upload list

// --- DOM ELEMENTS ---
const gameNameInput = document.getElementById("gameName");
const folderNameInput = document.getElementById("folderName");
const zipFileInput = document.getElementById("zipFile");
const uploadButton = document.getElementById("uploadButton");
const zipProgress = document.getElementById("zip-progress");
const videoProgress = document.getElementById("video-progress");

// Mode selection
const singleVideoContainer = document.getElementById("single-video-container");
const multiVideoContainer = document.getElementById("multi-video-container");
const addVideoFileInput = document.getElementById("addVideoFile");
const videoFileList = document.getElementById("video-file-list");
const emptyListMessage = document.querySelector("#multi-video-container .empty-list-message");

// Single-file input (for single video mode)
const singleVideoInput = document.getElementById("videoFile");

// Result link
const resultContainer = document.getElementById("result-container");
const s3FolderLink = document.getElementById("s3-folder-link");
const copyS3LinkButton = document.getElementById("copy-s3-link-button");

// --- EVENT LISTENERS ---

// Copy S3 link to clipboard
copyS3LinkButton.addEventListener('click', () => {
    const linkToCopy = s3FolderLink.href;
    navigator.clipboard.writeText(linkToCopy).then(() => {
        // Provide user feedback
        const originalContent = copyS3LinkButton.innerHTML;
        copyS3LinkButton.textContent = 'Copied!';
        setTimeout(() => {
            copyS3LinkButton.innerHTML = originalContent;
        }, 2000); // Revert after 2 seconds
    }).catch(err => {
        console.error('Failed to copy link: ', err);
        alert('Failed to copy link. Please copy it manually.');
    });
});

// Switch between single and multi-video upload modes
document.querySelectorAll('input[name="video-mode"]').forEach(radio => {
    radio.addEventListener('change', (event) => {
        if (event.target.value === 'single') {
            singleVideoContainer.style.display = 'block';
            multiVideoContainer.style.display = 'none';
        } else {
            singleVideoContainer.style.display = 'none';
            multiVideoContainer.style.display = 'block';
        }
    });
});

// Add a video to the list in multi-upload mode
addVideoFileInput.addEventListener('change', () => {
    const file = addVideoFileInput.files[0];
    if (file) {
        videoFiles.push(file);
        renderVideoList();
    }
    addVideoFileInput.value = ''; // Reset input
});

// Main upload button click handler
uploadButton.addEventListener("click", async () => {
    const gameName = gameNameInput.value.trim();
    const folderName = folderNameInput.value;
    const zipFile = zipFileInput.files[0];
    const uploadMode = document.querySelector('input[name="video-mode"]:checked').value;

    let finalVideoFiles = [];
    if (uploadMode === 'single') {
        if (singleVideoInput.files[0]) {
            finalVideoFiles.push(singleVideoInput.files[0]);
        }
    } else {
        finalVideoFiles = videoFiles;
    }
    
    // --- VALIDATION ---
    if (!gameName) {
        alert("Please enter a game name.");
        return;
    }
    if (!zipFile && finalVideoFiles.length === 0) {
        alert("Please select a zip file or at least one video file.");
        return;
    }
    if (finalVideoFiles.length === 0) {
        alert("Please select at least one video file.");
        return;
    }
    if (!API_GATEWAY_URL || API_GATEWAY_URL === "YOUR_API_GATEWAY_URL") {
        alert("Please configure the API_GATEWAY_URL in script.js");
        return;
    }

    // --- RESET UI ---
    resetProgress(zipProgress);
    resetProgress(videoProgress);
    resultContainer.style.display = 'none'; // Hide result link
    uploadButton.disabled = true;
    uploadButton.textContent = "Getting upload URLs...";

    // --- API PAYLOAD PREPARATION ---
    try {
        const videoPayload = finalVideoFiles.map(file => ({ videoFileType: file.type }));
        const payload = {
            gameName,
            folderName,
            videos: videoPayload,
        };
        if (zipFile) {
            payload.zipFileType = zipFile.type;
        }

        // --- API CALL ---
        const response = await fetch(API_GATEWAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const { zipUploadUrl, videoUploadUrls, uploadSessionId, bucket, folder, region } = await response.json();
        uploadButton.textContent = "Uploading...";
        
        // --- UPLOAD EXECUTION ---
        const uploadPromises = [];
        if (zipFile && zipUploadUrl) {
            uploadPromises.push(uploadFile(zipFile, zipUploadUrl, zipProgress));
        }

        if (finalVideoFiles.length > 0 && videoUploadUrls && videoUploadUrls.length > 0) {
            const videoUploadPromise = uploadVideos(finalVideoFiles, videoUploadUrls, videoProgress);
            uploadPromises.push(videoUploadPromise);
        }
        
        await Promise.all(uploadPromises);
        
        let finalBucket = bucket;
        let finalFolder = folder;
        let finalRegion = region;

        // --- CONCATENATION TRIGGER ---
        if (uploadMode === 'multiple' && finalVideoFiles.length > 1) {
            uploadButton.textContent = "Processing...";
            const videoStatus = videoProgress.querySelector('.status');
            const videoPercent = videoProgress.querySelector('.percent-text');
            videoStatus.textContent = 'Uploads complete.';
            videoPercent.textContent = 'Now processing...';
            
            const concatData = await triggerConcatenation(uploadSessionId, folderName, gameName);
            finalBucket = concatData.bucket;
            finalFolder = concatData.folder;
            finalRegion = concatData.region;

            videoStatus.textContent = 'Processing complete!';
            videoPercent.textContent = '✅';
            videoStatus.style.color = "green";
        }

        uploadButton.textContent = "Done!";

        // --- DISPLAY S3 FOLDER LINK ---
        displayS3Link(finalBucket, finalFolder, finalRegion);

    } catch (err) {
        console.error("Upload process failed:", err);
        alert(`Upload process failed: ${err.message}`);
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload";
    }
});


// --- HELPER FUNCTIONS ---

// Trigger the backend process to concatenate videos
const triggerConcatenation = async (uploadSessionId, folderName, gameName) => {
    if (!CONCATENATE_API_URL || CONCATENATE_API_URL === "YOUR_CONCATENATION_API_URL") {
        alert("Please configure the CONCATENATE_API_URL in script.js");
        throw new Error("Concatenation API URL not configured.");
    }

    const response = await fetch(CONCATENATE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            uploadSessionId,
            folderName,
            gameName
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to start concatenation process.");
    }

    console.log("Concatenation process started successfully.");
    return response.json();
};

// Display the final S3 link
const displayS3Link = (bucket, folder, region) => {
    if (!bucket || !folder || !region) {
        console.warn("Could not display S3 link because bucket, folder, or region was missing.");
        return;
    }
    const url = `https://s3.console.aws.amazon.com/s3/buckets/${bucket}?region=${region}&prefix=${folder}/`;
    s3FolderLink.href = url;
    resultContainer.style.display = 'block';
};

// Update folder name based on game name
window.onload = () => {
    const today = new Date();
    const dateString = today.toISOString().split("T")[0];
    folderNameInput.value = `${dateString}-your-game-name`;
};
gameNameInput.addEventListener('input', () => {
    const today = new Date();
    const dateString = today.toISOString().split("T")[0];
    const gameName = gameNameInput.value.trim();
    if (gameName) {
        const sanitizedGameName = gameName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        folderNameInput.value = `${dateString}-${sanitizedGameName}`;
    } else {
        folderNameInput.value = `${dateString}-your-game-name`;
    }
});

// Render the list of videos for multi-upload
const renderVideoList = () => {
    videoFileList.innerHTML = ''; // Clear existing list
    if (videoFiles.length === 0) {
        emptyListMessage.style.display = 'block';
    } else {
        emptyListMessage.style.display = 'none';
        videoFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.dataset.id = index;
            li.innerHTML = `
                <span>${file.name}</span>
                <button class="remove-video-btn" data-index="${index}">&times;</button>
            `;
            videoFileList.appendChild(li);
        });

        // Add remove button listeners
        document.querySelectorAll('.remove-video-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const indexToRemove = parseInt(e.target.dataset.index, 10);
                videoFiles.splice(indexToRemove, 1);
                renderVideoList();
            });
        });
    }
};

// Initialize SortableJS for drag-and-drop
new Sortable(videoFileList, {
    animation: 150,
    onEnd: (evt) => {
        // Reorder the videoFiles array to match the new DOM order
        const [movedItem] = videoFiles.splice(evt.oldIndex, 1);
        videoFiles.splice(evt.newIndex, 0, movedItem);
        renderVideoList(); // Re-render to update indexes
    }
});

const resetProgress = (progressElement) => {
    const statusElement = progressElement.querySelector(".status");
    const progressBarInner = progressElement.querySelector(".progress-bar-inner");
    const percentText = progressElement.querySelector(".percent-text");

    statusElement.textContent = "Not started";
    statusElement.style.color = '';
    progressBarInner.style.width = "0%";
    percentText.textContent = "";
};

// Upload a single file (used for the zip)
const uploadFile = (file, url, progressElement) => {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader('Content-Type', file.type);

        const statusElement = progressElement.querySelector(".status");
        const progressBarInner = progressElement.querySelector(".progress-bar-inner");
        const percentText = progressElement.querySelector(".percent-text");

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentUploaded = Math.round((event.loaded / event.total) * 100);
                progressBarInner.style.width = `${percentUploaded}%`;
                statusElement.textContent = `In progress...`;
                percentText.textContent = `${percentUploaded}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                statusElement.textContent = "Completed";
                percentText.textContent = `100%`;
                statusElement.style.color = "green";
                resolve(xhr.response);
            } else {
                statusElement.textContent = `Error: Upload failed (status ${xhr.status})`;
                percentText.textContent = "";
                statusElement.style.color = "red";
                reject(new Error(`Upload failed with status: ${xhr.status} - ${xhr.statusText}`));
            }
        };

        xhr.onerror = () => {
            statusElement.textContent = "Error: Network error during upload.";
            percentText.textContent = "";
            statusElement.style.color = "red";
            reject(new Error("Network error during upload."));
        };

        statusElement.textContent = "Starting...";
        percentText.textContent = "";
        progressBarInner.style.width = "0%";
        xhr.send(file);
    });
};

// Upload multiple videos and track combined progress
const uploadVideos = (files, urls, progressElement) => {
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    let totalUploaded = 0;
    let fileUploaded = new Array(files.length).fill(0);

    const statusElement = progressElement.querySelector(".status");
    const progressBarInner = progressElement.querySelector(".progress-bar-inner");
    const progressLabel = progressElement.querySelector("p");
    const percentText = progressElement.querySelector(".percent-text");

    // Update the label text without destroying the child spans
    progressLabel.childNodes[0].nodeValue = files.length > 1 ? 'Combined Video: ' : 'Video Upload: ';
    statusElement.textContent = "Starting...";
    percentText.textContent = "";

    const uploadPromises = files.map((file, index) => {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", urls[index], true);
            xhr.setRequestHeader('Content-Type', file.type);
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const loaded = event.loaded;
                    totalUploaded += loaded - fileUploaded[index];
                    fileUploaded[index] = loaded;
                    const percentUploaded = Math.round((totalUploaded / totalSize) * 100);
                    progressBarInner.style.width = `${percentUploaded}%`;
                    statusElement.textContent = `In progress...`;
                    percentText.textContent = `${percentUploaded}%`;
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                } else {
                    reject(new Error(`Upload failed for ${file.name} with status: ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error(`Network error during upload for ${file.name}.`));
            xhr.send(file);
        });
    });

    return Promise.all(uploadPromises).then(() => {
        statusElement.textContent = "Completed";
        percentText.textContent = "100%";
        statusElement.style.color = "green";
    }).catch(err => {
        statusElement.textContent = `Error: ${err.message}`;
        percentText.textContent = "";
        statusElement.style.color = "red";
        throw err;
    });
}; 