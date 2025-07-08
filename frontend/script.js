// --- CONFIGURATION ---
const API_GATEWAY_URL = "https://quf9mii5ia.execute-api.ap-south-1.amazonaws.com/default/uploadVideo";
const CONCATENATE_API_URL = "https://tw60zlvgf3.execute-api.ap-south-1.amazonaws.com/default/concatenateVideos";

// --- STATE ---
let videoFiles = []; // Array to hold File objects for the multi-upload list
let modifiedZipBlob = null; // To hold the newly generated zip file
let zipDataCache = null; // To hold parsed zip data AND the raw zip content
let currentZipFile = null; // To explicitly track the selected zip file

// --- DOM ELEMENTS ---
const gameNameInput = document.getElementById("gameName");
const folderNameInput = document.getElementById("folderName");
const zipFileInput = document.getElementById("zipFile");
const zipFileNameDisplay = document.getElementById("zip-file-name");
const uploadButton = document.getElementById("uploadButton");
const progressContainer = document.getElementById("progress-container");

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

// Modal elements
const packagesModal = document.getElementById('packages-modal');
const playerListContainer = document.getElementById('player-list-container');
const savePackagesButton = document.getElementById('save-packages-button');
const editPackagesButton = document.getElementById('edit-packages-button');
const cancelPackagesButton = document.getElementById('cancel-packages-button');
const closeModalButton = document.getElementById('close-modal-button');


// --- EVENT LISTENERS ---

// Copy S3 link to clipboard
copyS3LinkButton.addEventListener('click', () => {
    const linkToCopy = s3FolderLink.href;
    navigator.clipboard.writeText(linkToCopy).then(() => {
        // Provide user feedback
        const originalContent = copyS3LinkButton.textContent;
        copyS3LinkButton.textContent = 'Copied!';
        setTimeout(() => {
            copyS3LinkButton.textContent = 'Copy Link';
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

// Handle Zip file selection
zipFileInput.addEventListener('change', async (event) => {
    const newFile = event.target.files[0];

    if (newFile) {
        // A new file was selected.
        currentZipFile = newFile;
        zipFileNameDisplay.textContent = currentZipFile.name; // Update our custom display
        resetZipState();
        editPackagesButton.style.display = 'inline-block';
    } else {
        // No new file was selected (user hit cancel).
        // Our `currentZipFile` variable preserves the state, and our custom
        // `zipFileNameDisplay` continues to show the user what's selected.
        // We don't need to do anything here.
        console.log("File selection cancelled, preserving previous state.");
    }
});

// Re-open the modal to edit packages
editPackagesButton.addEventListener('click', async () => {
    if (zipDataCache) {
        // If cache exists, just show the modal
        packagesModal.style.display = 'flex';
        return;
    }

    // First time opening, process the file
    if (!currentZipFile) {
        alert("Please select a zip file first.");
        return;
    }

    uploadButton.disabled = true;
    uploadButton.textContent = "Processing Zip...";
    
    try {
        const fileBuffer = await currentZipFile.arrayBuffer();
        const zip = await JSZip.loadAsync(fileBuffer);
        const playerCsvFile = zip.file("players.csv");

        if (!playerCsvFile) throw new Error("`players.csv` not found in the zip file.");

        const csvContent = await playerCsvFile.async("string");
        const parseResult = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
        
        if (!parseResult.data || parseResult.data.length === 0) throw new Error("`players.csv` is empty or invalid.");

        zipDataCache = { players: parseResult.data, zip, rawBuffer: fileBuffer };
        populateAndShowModal();

    } catch (error) {
        alert(`Error processing zip file: ${error.message}`);
        resetZipState();
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload";
    }
});


// Main upload button click handler
uploadButton.addEventListener("click", async () => {
    const gameName = gameNameInput.value.trim();
    const finalS3Folder = folderNameInput.value;
    // Use the modified zip blob if it exists, otherwise use the original file
    const zipFile = modifiedZipBlob || currentZipFile;
    const uploadMode = document.querySelector('input[name="video-mode"]:checked').value;

    let finalVideoFiles = [];
    if (uploadMode === 'single') {
        if (singleVideoInput.files[0]) finalVideoFiles.push(singleVideoInput.files[0]);
    } else {
        finalVideoFiles = videoFiles;
    }

    // --- VALIDATION ---
    if (!gameName) return alert("Please enter a game name.");

    const allFilesToUpload = [...finalVideoFiles];
    if (zipFile) allFilesToUpload.unshift(zipFile);

    if (allFilesToUpload.length === 0) return alert("Please select at least one file to upload.");
    if (!API_GATEWAY_URL) return alert("Please configure the API_GATEWAY_URL in script.js");

    // --- RESET UI ---
    progressContainer.innerHTML = '<h2>Upload Progress</h2>';
    resultContainer.style.display = 'none';
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading...";

    try {
        const uploadSessionId = `upload-${Date.now()}`;
        const isSingleVideo = uploadMode === 'single' && finalVideoFiles.length === 1;
        const sanitizedGameName = gameName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');

        // --- UPLOAD EXECUTION ---
        const uploader = new S3MultipartUploader(allFilesToUpload, {
            gameName: sanitizedGameName,
            finalS3Folder,
            uploadSessionId,
            isSingleVideo,
            progressContainer
        });
        await uploader.upload();

        // --- FINALIZE / CONCATENATE ---
        if (!isSingleVideo && finalVideoFiles.length > 1) {
            uploadButton.textContent = "Processing...";
            const concatData = await triggerConcatenation(uploadSessionId, finalS3Folder, sanitizedGameName);
            console.log("Concatenation complete:", concatData);
            displayS3Link(concatData.bucket, concatData.folder, concatData.region);
        } else {
            // For single videos and zips, the upload is already in its final location.
            // We need a way to get bucket/region info. Let's hardcode for now as a fallback.
            displayS3Link("playernation-games", finalS3Folder, "ap-south-1");
        }

        uploadButton.textContent = "Done!";

    } catch (err) {
        console.error("Upload process failed:", err);
        alert(`Upload process failed: ${err.message}`);
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload";
    }
});

// --- BACKEND COMMUNICATION ---
async function callBackend(action, params) {
    const response = await fetch(API_GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Backend Error: ${err.error || response.statusText}`);
    }
    return response.json();
}

// --- S3 MULTIPART UPLOADER CLASS ---

class S3MultipartUploader {
    constructor(files, options) {
        this.files = files;
        this.options = options;
        this.chunkSize = 10 * 1024 * 1024; // 10MB
        this.threads = 4;
    }

    async upload() {
        const allPromises = this.files.map(file => {
            let displayName = file.name;
            // If we're uploading a modified zip blob, which has no name,
            // use the name of the original zip file for display purposes.
            if (!displayName && file instanceof Blob && zipFileInput.files[0]) {
                displayName = zipFileInput.files[0].name;
            }
            return this.uploadFile(file, displayName);
        });
        return Promise.all(allPromises);
    }

    async uploadFile(file, displayName) {
        const progressElement = this.createProgressElement(displayName || 'file');
        this.options.progressContainer.appendChild(progressElement);
        
        let s3Key;
        if (file.type.startsWith('video/')) {
            if (this.options.isSingleVideo) {
                // Upload directly to final destination
                s3Key = `${this.options.finalS3Folder}/Game Video/${this.options.gameName}.${file.name.split('.').pop()}`;
            } else {
                // Use temp folder for multi-video concatenation
                s3Key = `tmp-uploads/${this.options.uploadSessionId}/${file.name}`;
            }
        } else if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
            // Standardize the zip file name upon upload
            s3Key = `${this.options.finalS3Folder}/Zip File/Game Info - ${this.options.gameName}.zip`;
        } else {
            // Fallback for other file types, though currently not used.
            s3Key = `${this.options.finalS3Folder}/Other/${file.name}`;
        }

        try {
            if (file.size < this.chunkSize) {
                await this.uploadSingle(file, s3Key, progressElement);
            } else {
                await this.uploadMultipart(file, s3Key, progressElement);
            }
            this.updateProgress(progressElement, 1, 'Complete');
        } catch (error) {
            console.error(`Upload failed for ${file.name}:`, error);
            this.updateProgress(progressElement, 1, `Error: ${error.message}`);
            throw error; // Re-throw to fail the Promise.all
        }
    }

    async uploadSingle(file, key, progressElement) {
        const { url } = await callBackend('get-presigned-put-url', { key });
        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", url, true);
            xhr.setRequestHeader('Content-Type', file.type);
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) this.updateProgress(progressElement, event.loaded / event.total);
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
            xhr.onerror = () => reject(new Error('Network error.'));
            xhr.send(file);
        });
    }

    async uploadMultipart(file, key, progressElement) {
        const { uploadId } = await callBackend('create-multipart-upload', { key });

        const totalChunks = Math.ceil(file.size / this.chunkSize);
        const { urls } = await callBackend('get-presigned-part-urls', { key, uploadId, partCount: totalChunks });

        let uploadedPartsCount = 0;
        const partUploadPromises = urls.map((url, index) => {
            const partNumber = index + 1;
            const start = index * this.chunkSize;
            const end = Math.min(start + this.chunkSize, file.size);
            const chunk = file.slice(start, end);

            return this.uploadPart(url, chunk).then(etag => {
                uploadedPartsCount++;
                this.updateProgress(progressElement, uploadedPartsCount / totalChunks);
                return { ETag: etag, PartNumber: partNumber };
            });
        });

        const parts = await Promise.all(partUploadPromises);
        parts.sort((a, b) => a.PartNumber - b.PartNumber);

        await callBackend('complete-multipart-upload', { key, uploadId, parts });
    }

    async uploadPart(url, chunk) {
        const response = await fetch(url, { method: 'PUT', body: chunk });
        if (!response.ok) throw new Error(`Part upload failed: ${response.status}`);
        const etag = response.headers.get('ETag');
        if (!etag) throw new Error('ETag not found in part upload response.');
        return etag;
    }

    createProgressElement(fileName) {
        const element = document.createElement('div');
        element.classList.add('progress-item');
        element.innerHTML = `
            <p>${fileName}: <span class="status">Starting...</span><span class="percent-text"></span></p>
            <div class="progress-bar">
                <div class="progress-bar-inner"></div>
            </div>
        `;
        return element;
    }

    updateProgress(element, fraction, statusText = null) {
        const progressBarInner = element.querySelector(".progress-bar-inner");
        const percentText = element.querySelector(".percent-text");
        const statusElement = element.querySelector(".status");

        const percent = Math.round(fraction * 100);
        progressBarInner.style.width = `${percent}%`;
        percentText.textContent = ` ${percent}%`;

        if (statusText) {
            statusElement.textContent = statusText;
        } else if (fraction < 1) {
            statusElement.textContent = 'Uploading...';
        } else {
            statusElement.textContent = 'Processing...';
            statusElement.style.color = "#4CAF50";
        }
    }
}


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

// --- RENDER AND UI ---

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

// --- MODAL AND ZIP HANDLING ---

function populateAndShowModal() {
    if (!zipDataCache) return;

    playerListContainer.innerHTML = ''; // Clear previous content

    // Group players by team
    const playersByTeam = zipDataCache.players.reduce((acc, player) => {
        const teamName = player.team_name || 'No Team Assigned';
        if (!acc[teamName]) {
            acc[teamName] = [];
        }
        acc[teamName].push(player);
        return acc;
    }, {});

    // Render the grouped list
    for (const teamName in playersByTeam) {
        const teamGroup = document.createElement('div');
        teamGroup.classList.add('team-group');
        teamGroup.innerHTML = `<h3>${teamName}</h3>`;

        playersByTeam[teamName].forEach(player => {
            const playerName = player.player_name || 'Unknown Player';
            const existingPackage = player.PACKAGE_SELECTION || 'none';
            // Use player object itself to find index later, avoiding simple index issues
            const originalIndex = zipDataCache.players.indexOf(player);

            const row = document.createElement('div');
            row.classList.add('player-row');
            row.dataset.index = originalIndex;

            row.innerHTML = `
                <div class="player-info">
                    <span class="player-name">${playerName}</span>
                </div>
                <div class="package-options">
                    <select>
                        <option value="none" ${existingPackage === 'none' ? 'selected' : ''}>None</option>
                        <option value="stat" ${existingPackage === 'stat' ? 'selected' : ''}>Stat Package</option>
                        <option value="highlight" ${existingPackage === 'highlight' ? 'selected' : ''}>Highlight Package</option>
                        <option value="both" ${existingPackage === 'both' ? 'selected' : ''}>Both Packages</option>
                    </select>
                </div>
            `;
            teamGroup.appendChild(row);
        });
        playerListContainer.appendChild(teamGroup);
    }

    packagesModal.style.display = 'flex';

    // Attach event listeners for modal buttons
    savePackagesButton.onclick = () => handleSavePackages();
    cancelPackagesButton.onclick = () => closeModal();
}

function closeModal() {
    packagesModal.style.display = 'none';
    // This now does nothing but close the modal. State is preserved.
}

function resetZipState() {
    // This function now only resets the *modified* data.
    // The currentZipFile and its display are managed separately.
    modifiedZipBlob = null;
    zipDataCache = null;
    editPackagesButton.style.display = 'none';

    // If we are truly resetting, clear the display text too.
    // This happens when a new file is chosen.
    if (!currentZipFile) {
        zipFileNameDisplay.textContent = '';
    }
}

async function handleSavePackages() {
    if (!zipDataCache) return;

    const playerRows = playerListContainer.querySelectorAll('.player-row');
    const updatedPlayers = [...zipDataCache.players];

    playerRows.forEach(row => {
        const index = parseInt(row.dataset.index, 10);
        const selectedPackage = row.querySelector('select').value;
        updatedPlayers[index].PACKAGE_SELECTION = selectedPackage;
    });

    const newCsvContent = Papa.unparse(updatedPlayers, { header: true });

    zipDataCache.zip.file("players.csv", newCsvContent);

    try {
        modifiedZipBlob = await zipDataCache.zip.generateAsync({ type: "blob" });
        console.log("New zip file created in memory.");

        packagesModal.style.display = 'none';
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload";
        editPackagesButton.style.display = 'inline-block'; // Show the edit button

    } catch (error) {
        alert("Failed to generate the updated zip file. Please try again.");
        console.error("Zip generation error:", error);
        resetZipState();
    }
} 