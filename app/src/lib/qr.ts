// A QR code as a grid of dark and light modules. The encoder loads on first use, so pages that never show a QR
// code do not download it.
export type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean }

export async function qrMatrix(text: string): Promise<QrMatrix> {
  const { default: qrcode } = await import('qrcode-generator')
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) }
}

// One SVG path for all dark modules, offset by a quiet zone of `margin` modules.
export function qrPath(m: QrMatrix, margin = 4): string {
  let d = ''
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`
  return d
}
