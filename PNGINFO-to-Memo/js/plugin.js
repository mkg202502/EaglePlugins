const fs = require('fs');
const zlib = require('zlib');

// PNGINFOを取得する関数（改良版）
function extractPngInfo(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                return reject("[ERROR] ファイルを読み込めませんでした: " + err);
            }

            let offset = 8; // PNGファイルのシグネチャをスキップ
            while (offset < data.length) {
                const chunkLength = data.readUInt32BE(offset);
                const chunkType = data.toString('ascii', offset + 4, offset + 8);

                if (chunkType === 'tEXt') {
                    console.log(`[DEBUG] tEXt チャンク発見: ${chunkType}`);
                    const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
                    let text = chunkData.toString('utf-8').replace(/\0/g, ' ');
                    console.log(`[DEBUG] 取得した tEXt チャンク:`, text);
                    resolve(text);
                    return;

                } else if (chunkType === 'iTXt') {
                    console.log(`[DEBUG] iTXt チャンク発見`);
                    const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);

                    // `iTXt` はヘッダー付きなので、それを処理する
                    let nullIndex = chunkData.indexOf(0);
                    let compressionFlag = chunkData[nullIndex + 1];
                    let compressionMethod = chunkData[nullIndex + 2];

                    let textDataStart = chunkData.indexOf(0, nullIndex + 3) + 1; // 言語タグスキップ
                    textDataStart = chunkData.indexOf(0, textDataStart) + 1; // 翻訳スキップ
                    let textData = chunkData.slice(textDataStart);

                    if (compressionFlag === 1 && compressionMethod === 0) {
                        // zlib 圧縮されている場合は解凍
                        console.log(`[DEBUG] 圧縮されている iTXtチャンク`);
                        zlib.inflate(textData, (err, decompressed) => {
                            if (err) {
                                reject("[ERROR] iTXt データの解凍に失敗しました: " + err);
                                return;
                            }
                            let decodedText = decompressed.toString('utf-8').replace(/\0/g, ' ');
                            console.log(`[DEBUG] 取得した iTXt チャンク:`, decodedText);
                            resolve(decodedText);
                            return;
                        });
                    } else {
                        // 非圧縮の場合
                        console.log(`[DEBUG] 非圧縮のiTXt チャンク`);
                        let decodedText = textData.toString('utf-8').replace(/\0/g, ' ');
                        console.log(`[DEBUG] 取得した iTXt チャンク:`, decodedText);
                        resolve(decodedText);
                        return;
                    }
                } else if (chunkType === 'zTXt') {
                    console.log(`[DEBUG] zTXt チャンク発見: ${chunkType}`);
                    const keywordEnd = data.indexOf(0, offset + 8);
                    const compressedData = data.slice(keywordEnd + 2, offset + 8 + chunkLength);

                    zlib.inflate(compressedData, (err, decompressed) => {
                        if (err) {
                            return reject("[ERROR] zTXt データの解凍に失敗しました: " + err);
                        }
                        let decodedText = decompressed.toString('utf-8').replace(/\0/g, ' ');
                        console.log(`[DEBUG] 取得した zTXt チャンク:`, decodedText);
                        resolve(decodedText);
                        return;
                    });
                }
                offset += 8 + chunkLength + 4; // チャンクサイズ + タイプ + CRC
            }
            return reject('[INFO] PNGINFOが見つかりませんでした。');
        });
    });
}

// PNGINFOをメモに追加する処理
async function extractAndSavePngInfo() {
    let items = await eagle.item.getSelected();
    if (!items || items.length === 0) {
        console.log("[extractPngInfo] 選択されたファイルがありません。");
        return;
    }

    let pngItems = items.filter(item => item.ext === "png");
    if (pngItems.length === 0) {
        console.log("[extractPngInfo] 選択されたファイルの中にPNGファイルがありません。");
        return;
    }

    let failedImages = [];

    for (const pngItem of pngItems) {
        console.log(`[extractPngInfo] 処理中: ${pngItem.name} (ID: ${pngItem.id})`);

        let itemDetails = await eagle.item.getById(pngItem.id);
        if (!itemDetails) {
            console.log('[ERROR] アイテムの詳細情報が取得できませんでした。');
            failedImages.push(pngItem.name);
            continue;
        }

        if (itemDetails.annotation != '') {
            console.log('[NOTICE] アイテムのメモに書き込みがあるため、スキップします。');
            failedImages.push(pngItem.name);
            continue;
        }

        let filePath = itemDetails.filePath;
        if (!filePath) {
            console.log('[ERROR] アイテムの filePath が見つかりませんでした。');
            failedImages.push(pngItem.name);
            continue;
        }

        try {
            const pngInfo = await extractPngInfo(filePath);
            console.log('[SUCCESS] PNGINFOを取得しました。');
            console.log(pngInfo);
            itemDetails.annotation = pngInfo;
            await itemDetails.save();
            console.log('[SUCCESS] メモにPNGINFOを追加しました。');
        } catch (error) {
            console.log(`[ERROR] PNGINFO の取得またはメモへの追加に失敗: ${JSON.stringify(error, null, 2)}`);
            failedImages.push(pngItem.name);
        }
    }

    if (failedImages.length > 0) {
        displayFailedImages(failedImages);
    }

    let container = document.getElementById("closing");
    if (!container) {
        container = document.createElement("div");
        container.id = "closing";
        document.body.appendChild(container);
    }
    
    container.innerHTML += `<h3>処理が終了しました。このウィンドウを閉じてください。</h3>`;
}

function displayFailedImages(failedImages) {
    let container = document.getElementById("failed-images");
    if (!container) {
        container = document.createElement("div");
        container.id = "failed-images";
        document.body.appendChild(container);
    }

    container.innerHTML += `<h3>メモを書けなかった画像</h3><ul>` +
        failedImages.map(name => `<li>${name}</li>`).join("") +
        `</ul>`;
}

eagle.onPluginCreate((plugin) => {
    document.body.style.backgroundColor = '#222'; // 背景を暗めのグレーに
    document.body.style.color = '#fff'; // 文字色を白に
    console.log('eagle.onPluginCreate');
    console.log(plugin);

    document.querySelector('#message').innerHTML = `
    <ul>
        <li>id: ${plugin.manifest.id}</li>
        <li>version: ${plugin.manifest.version}</li>
        <li>name: ${plugin.manifest.name}</li>
        <li>logo: ${plugin.manifest.logo}</li>
        <li>path: ${plugin.path}</li>
    </ul>

    <!-- デバッグ用 <<button id="extractAndSavePngInfo">PNGINFOをメモに書き込み</button> -->
    `;

    /* デバッグ用
    const extractAndSavePngInfoButton = document.getElementById('extractAndSavePngInfo');
    if (extractAndSavePngInfoButton) {
        extractAndSavePngInfoButton.addEventListener('click', extractAndSavePngInfo);
        console.log("[DEBUG] extractAndSavePngInfo ボタンのイベントを設定しました。");
    } else {
        console.log("[ERROR] extractAndSavePngInfo ボタンが見つかりませんでした。");
    } */
    
    console.log('[DEBUG] プラグインのセットアップ完了！');

});

eagle.onPluginRun(() => {
    console.log("[DEBUG] プラグインが右クリックメニューから実行されました！");
    extractAndSavePngInfo();
});
