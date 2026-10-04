/** Só roda no navegador. Reduz fotos grandes para caberem no limite de upload (4 MB), sem pedir nada ao usuário. */
const TARGET_BYTES = 3.5 * 1024 * 1024;
const MAX_SIDE = 2400;

const loadBitmap = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });

const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Devolve o próprio arquivo se já couber; senão, uma versão JPEG redimensionada. GIF grande não é reduzido (perderia a animação). */
export async function prepareImageFile(file: File): Promise<File> {
  if (file.size <= TARGET_BYTES) return file;
  if (file.type === "image/gif") throw new Error("O GIF passa do limite de 4 MB. Use um arquivo menor.");

  const img = await loadBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível reduzir a imagem neste navegador.");
  ctx.fillStyle = "#ffffff"; // PNG com transparência vira JPEG: fundo branco em vez de preto
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= TARGET_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
  }
  throw new Error("Não foi possível reduzir a imagem para menos de 4 MB.");
}
