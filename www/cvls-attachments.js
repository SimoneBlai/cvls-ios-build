/* =========================================================
   CVLS LOCAL ATTACHMENTS
   Salvataggio locale allegati per Capacitor Android/iOS

   Step attuale:
   - selezione file/foto
   - salvataggio locale in IndexedDB
   - creazione metadata compatibili con vecchio AndroidBridge

   Step successivo:
   - upload su Drive tramite APP_CVLS_API
========================================================= */

(function () {
    const DB_NAME = "CVLS_LOCAL_ATTACHMENTS_DB";
    const DB_VERSION = 1;
    const STORE_NAME = "attachments";

    function openDb() {
        return new Promise(function (resolve, reject) {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = function () {
                reject(new Error("Impossibile aprire archivio allegati locale."));
            };

            request.onupgradeneeded = function (event) {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, {
                        keyPath: "localFileId"
                    });
                }
            };

            request.onsuccess = function () {
                resolve(request.result);
            };
        });
    }

    function generateSyncId() {
        return (
            "ATT-" +
            Date.now().toString(36).toUpperCase() +
            "-" +
            Math.random().toString(36).substring(2, 10).toUpperCase()
        );
    }

    function putAttachment(record) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);

                store.put(record);

                tx.oncomplete = function () {
                    db.close();
                    resolve(record);
                };

                tx.onerror = function () {
                    db.close();
                    reject(new Error("Impossibile salvare allegato locale."));
                };
            });
        });
    }

    function getAttachment(localFileId) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(localFileId);

                request.onsuccess = function () {
                    db.close();
                    resolve(request.result || null);
                };

                request.onerror = function () {
                    db.close();
                    reject(new Error("Impossibile leggere allegato locale."));
                };
            });
        });
    }

    function deleteAttachment(localFileId) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);

                store.delete(localFileId);

                tx.oncomplete = function () {
                    db.close();
                    resolve(true);
                };

                tx.onerror = function () {
                    db.close();
                    reject(new Error("Impossibile eliminare allegato locale."));
                };
            });
        });
    }

    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onload = function () {
                resolve(String(reader.result || ""));
            };

            reader.onerror = function () {
                reject(new Error("Impossibile leggere il file."));
            };

            reader.readAsDataURL(blob);
        });
    }

    function createInputForMode(mode) {
        const input = document.createElement("input");

        input.type = "file";
        input.style.position = "fixed";
        input.style.left = "-9999px";
        input.style.top = "-9999px";
        input.style.opacity = "0";

        if (mode === "camera") {
            input.accept = "image/*";
            input.setAttribute("capture", "environment");
            input.multiple = false;
        } else {
            input.multiple = true;
        }

        document.body.appendChild(input);

        return input;
    }

    function selectAttachments(options) {
        const mode = options && options.mode === "camera"
            ? "camera"
            : "files";

        return new Promise(function (resolve) {
            const input = createInputForMode(mode);

            input.addEventListener("change", function () {
                const selectedFiles = Array.from(input.files || []);

                setTimeout(function () {
                    if (input && input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                }, 300);

                if (selectedFiles.length === 0) {
                    resolve({
                        files: [],
                        errors: []
                    });
                    return;
                }

                const promises = selectedFiles.map(function (file) {
                    const syncId = generateSyncId();
                    const localFileId = "LOCAL-" + syncId;

                    const nomeFile =
                        file.name ||
                        (
                            mode === "camera"
                                ? "foto_" + Date.now() + ".jpg"
                                : "allegato_" + Date.now()
                        );

                    const record = {
                        localFileId: localFileId,
                        syncId: syncId,
                        nomeFile: nomeFile,
                        nomeOriginale: nomeFile,
                        mimeType: file.type || "application/octet-stream",
                        sizeBytes: Number(file.size) || 0,
                        originalSizeBytes: Number(file.size) || 0,
                        compressed: false,
                        createdAt: new Date().toISOString(),
                        blob: file
                    };

                    return putAttachment(record).then(function () {
                        return {
                            syncId: syncId,
                            localFileId: localFileId,
                            nomeFile: nomeFile,
                            nomeOriginale: nomeFile,
                            mimeType: record.mimeType,
                            sizeBytes: record.sizeBytes,
                            originalSizeBytes: record.originalSizeBytes,
                            compressed: false
                        };
                    });
                });

                Promise.allSettled(promises).then(function (results) {
                    const files = [];
                    const errors = [];

                    results.forEach(function (result) {
                        if (result.status === "fulfilled") {
                            files.push(result.value);
                        } else {
                            errors.push(String(result.reason && result.reason.message || result.reason || "Errore file"));
                        }
                    });

                    resolve({
                        files: files,
                        errors: errors
                    });
                });
            });

            input.click();
        });
    }

    window.CvlsLocalAttachments = {
        selectAttachments: selectAttachments,
        getAttachment: getAttachment,
        deleteAttachment: deleteAttachment,
        blobToDataUrl: blobToDataUrl
    };
})();