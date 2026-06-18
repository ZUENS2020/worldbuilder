/** Browser file download / upload helpers for import-export features. */

/** Trigger a download of `data` as a pretty-printed JSON file. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open the OS file picker and resolve with the parsed JSON of the chosen file.
 *  Resolves null if the user cancels. Rejects on invalid JSON. */
export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch (e) {
          reject(new Error('文件不是合法的 JSON'));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
      reader.readAsText(file);
    };
    input.click();
  });
}
