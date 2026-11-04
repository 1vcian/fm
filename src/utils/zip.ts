/**
 * A minimal ZIP writer for downloads: files deflated with the browser's own CompressionStream
 * ('deflate-raw'), or stored when the browser lacks it, plus CRC-32 and the local, central and end
 * records of the ZIP format (APPNOTE 6.3). No ZIP64: fine for archives under 4 GB and 65535 files.
 */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null; // 'deflate-raw' unsupported: store instead
    }
}

/** DOS date and time of `d`, as ZIP headers carry them. */
function dosTime(d: Date): { time: number; date: number } {
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/** A .zip of `files` (path -> text or bytes). */
export async function makeZip(files: { path: string; data: string | Uint8Array }[], when = new Date()): Promise<Blob> {
    const enc = new TextEncoder();
    const { time, date } = dosTime(when);
    const parts: BlobPart[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
        const name = enc.encode(f.path);
        const crc = crc32(raw);
        const deflated = await deflateRaw(raw);
        const useDeflate = !!deflated && deflated.length < raw.length;
        const body = useDeflate ? deflated! : raw;
        const method = useDeflate ? 8 : 0;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);         // version needed
        local.setUint16(6, 0x0800, true);     // UTF-8 names
        local.setUint16(8, method, true);
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, raw.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(local.buffer, name as BlobPart, body as BlobPart);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);           // version made by
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, method, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, date, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, body.length, true);
        cen.setUint32(24, raw.length, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);      // local header offset (the rest stays 0)
        const entry = new Uint8Array(46 + name.length);
        entry.set(new Uint8Array(cen.buffer), 0);
        entry.set(name, 46);
        central.push(entry);
        offset += 30 + name.length + body.length;
    }
    const centralSize = central.reduce((n, e) => n + e.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: 'application/zip' });
}

/** Saves `blob` as `name` through a temporary link. */
export function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
