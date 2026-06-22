/** Browser file download / upload helpers for import-export features. */
import i18n from '../i18n';

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
          reject(new Error(i18n.t('fileIo.invalidJson')));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error(i18n.t('fileIo.readFail')));
      reader.readAsText(file);
    };
    input.click();
  });
}

/** Decode a base64 string (possibly containing UTF-8 bytes) to a JS string. */
function _b64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Extract an embedded character card from a TavernAI/SillyTavern PNG.
 *  Cards live in a tEXt chunk keyed "ccv3" (V3) or "chara" (V2), whose value is
 *  base64-encoded JSON. Returns the parsed object, or null if no card chunk. */
function _cardFromPng(buf: ArrayBuffer): unknown | null {
  const bytes = new Uint8Array(buf);
  // PNG signature.
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error(i18n.t('fileIo.notPng'));

  const view = new DataView(buf);
  let off = 8;
  const found: Record<string, string> = {};
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const dataStart = off + 8;
    if (type === 'tEXt') {
      // keyword \0 text
      let nul = dataStart;
      const end = dataStart + len;
      while (nul < end && bytes[nul] !== 0) nul++;
      let keyword = '';
      for (let i = dataStart; i < nul; i++) keyword += String.fromCharCode(bytes[i]);
      let text = '';
      for (let i = nul + 1; i < end; i++) text += String.fromCharCode(bytes[i]);
      if (keyword === 'chara' || keyword === 'ccv3') found[keyword] = text;
    }
    if (type === 'IEND') break;
    off = dataStart + len + 4; // skip data + CRC
  }
  const raw = found['ccv3'] ?? found['chara'];
  if (!raw) return null;
  try {
    return JSON.parse(_b64ToUtf8(raw));
  } catch {
    throw new Error(i18n.t('fileIo.pngParseFail'));
  }
}

/** Open the file picker for a character card (.json or .png) and resolve with
 *  the parsed card object. Resolves null if the user cancels. Rejects on a
 *  malformed file or a PNG without an embedded card. */
export function pickCharacterCardFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,image/png,.png';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error(i18n.t('fileIo.readFail')));
      if (isPng) {
        reader.onload = () => {
          try {
            const card = _cardFromPng(reader.result as ArrayBuffer);
            if (!card) return reject(new Error(i18n.t('fileIo.pngNoCard')));
            resolve(card);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(i18n.t('fileIo.readCardFail')));
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try {
            resolve(JSON.parse(String(reader.result)));
          } catch {
            reject(new Error(i18n.t('fileIo.invalidJson')));
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  });
}
