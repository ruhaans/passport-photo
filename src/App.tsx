import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withPngDensity } from "@/services/pngDensity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  ImageIcon,
  FileImage,
  Printer,
  RotateCcw,
  RotateCw,
} from "lucide-react";

/* Page metadata is defined in index.html for the static build.
  head: () => ({
    meta: [
      { title: "Passport Photo Sheet Builder — 35x45mm Print Layouts" },
      {
        name: "description",
        content:
          "Arrange 35x45mm passport photos onto 4x6 or A4 sheets at 300 DPI and download a print-ready PNG. Runs entirely in your browser.",
      },
      { property: "og:title", content: "Passport Photo Sheet Builder — 35x45mm Print Layouts" },
      {
        property: "og:description",
        content:
          "Arrange 35x45mm passport photos onto 4x6 or A4 sheets at 300 DPI and download a print-ready PNG. Runs entirely in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
}); */

const DPI = 300;
const PIXELS_PER_MM = DPI / 25.4;
const PHOTO_W = Math.round((35 / 25.4) * DPI);
const PHOTO_H = Math.round((45 / 25.4) * DPI);
const OUTER_MARGIN = 4 * PIXELS_PER_MM;
const ROW_GAP = 1 * PIXELS_PER_MM;

const SHEETS = {
  "4x6": {
    label: "4x6 inch (up to 8 photos)",
    w: 1800,
    h: 1200,
    maxPhotos: 8,
    counts: [1, 2, 4, 6, 8],
  },
  a4: {
    label: "A4 paper (up to 30 photos)",
    w: 2480,
    h: 3508,
    maxPhotos: 30,
    counts: [1, 2, 4, 6, 8, 12, 16, 20, 24, 30],
  },
} as const;

type SheetKey = keyof typeof SHEETS;

function loadBrowserImage(source: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(source);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read the uploaded image."));
    };
    image.src = url;
  });
}

/** Best cols x rows grid for `target` photos on the sheet, or the largest that fits. */
function planGrid(
  sheet: { w: number; h: number; maxPhotos: number },
  target: number,
  cellW: number,
  cellH: number,
  preferredColumnGap: number,
) {
  const usableW = sheet.w - OUTER_MARGIN * 2;
  const usableH = sheet.h - OUTER_MARGIN * 2;
  const maxCols = Math.max(1, Math.floor(usableW / cellW));
  const maxRows = Math.max(
    1,
    Math.floor((usableH + ROW_GAP) / (cellH + ROW_GAP)),
  );
  const capacity = Math.min(maxCols * maxRows, sheet.maxPhotos);
  const count = Math.min(target, capacity);

  let best = { cols: 1, rows: 1, count: 1, columnGap: 0 };
  let bestScore = Infinity;
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols);
    if (rows > maxRows) continue;
    if (cols * (rows - 1) >= count) continue; // wasted whole row
    const maximumColumnGap =
      cols > 1 ? Math.max(0, (usableW - cols * cellW) / (cols - 1)) : 0;
    const columnGap = Math.min(preferredColumnGap, maximumColumnGap);
    const gridW = cols * cellW + (cols - 1) * columnGap;
    const gridH = rows * cellH + (rows - 1) * ROW_GAP;
    // prefer compact, balanced blocks
    const score =
      Math.abs(gridW / sheet.w - gridH / sheet.h) + cols * rows - count;
    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows, count, columnGap };
    }
  }
  return { ...best, capacity };
}

/**
 * The on-screen sheet keeps a 4 mm safety margin. Exports omit only that
 * outer margin; pixels within the remaining sheet are copied 1:1, so the
 * 35 x 45 mm photo cells never change size.
 */
function cropPreviewMargin(source: HTMLCanvasElement): HTMLCanvasElement {
  const marginPixels = Math.round(OUTER_MARGIN);
  const width = source.width - marginPixels * 2;
  const height = source.height - marginPixels * 2;
  if (width <= 0 || height <= 0) {
    throw new Error("The export area is invalid.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the export image.");
  context.drawImage(
    source,
    marginPixels,
    marginPixels,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  return canvas;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const uploadRequestRef = useRef(0);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [paper, setPaper] = useState<SheetKey>("4x6");
  const [perSheet, setPerSheet] = useState(8);
  const [columnSpacing, setColumnSpacing] = useState(12);
  const [border, setBorder] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0); // -100..100 (%)
  const [offsetY, setOffsetY] = useState(0);
  const [rotation, setRotation] = useState(0); // fine straighten, degrees
  const [quarter, setQuarter] = useState(0); // 90° steps

  const loadFile = useCallback(async (file: File) => {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setNotification("Please upload a JPG, JPEG, or PNG image.");
      return;
    }

    const requestId = ++uploadRequestRef.current;
    setFileName(file.name);
    setNotification(null);
    try {
      const image = await loadBrowserImage(file);
      if (requestId !== uploadRequestRef.current) {
        return;
      }

      setImg(image);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setRotation(0);
      setQuarter(0);

      if (window.matchMedia("(max-width: 1023px)").matches) {
        window.requestAnimationFrame(() => {
          previewRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      }
    } catch {
      if (requestId === uploadRequestRef.current) {
        setNotification("Unable to read this image.");
      }
    }
  }, []);

  // border is drawn OUTSIDE the constant 35x45mm photo area
  const cellW = PHOTO_W + border * 2;
  const cellH = PHOTO_H + border * 2;

  // Six photos fit more cleanly as a 2 × 3 grid on a portrait 4 × 6 sheet.
  const sheet = useMemo(() => {
    const base = SHEETS[paper];
    return paper === "4x6" && perSheet === 6
      ? { ...base, w: base.h, h: base.w }
      : base;
  }, [paper, perSheet]);

  const grid = useMemo(
    () => planGrid(sheet, perSheet, cellW, cellH, columnSpacing),
    [sheet, perSheet, cellW, cellH, columnSpacing],
  );

  const angle = ((quarter * 90 + rotation) * Math.PI) / 180;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = sheet.w;
    canvas.height = sheet.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, sheet.w, sheet.h);

    const { cols, rows, count } = grid;
    const gridW = cols * cellW + (cols - 1) * grid.columnGap;
    const gridH = rows * cellH + (rows - 1) * ROW_GAP;
    const offX = OUTER_MARGIN + (sheet.w - OUTER_MARGIN * 2 - gridW) / 2;
    const offY = OUTER_MARGIN + (sheet.h - OUTER_MARGIN * 2 - gridH) / 2;

    const srcW = img?.width ?? 0;
    const srcH = img?.height ?? 0;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const rotW = srcW * cos + srcH * sin;
    const rotH = srcW * sin + srcH * cos;
    let drawn = 0;
    for (let r = 0; r < rows && drawn < count; r++) {
      for (let c = 0; c < cols && drawn < count; c++) {
        drawn++;
        const cx = offX + c * (cellW + grid.columnGap);
        const cy = offY + r * (cellH + ROW_GAP);
        const x = cx + border;
        const y = cy + border;

        if (border > 0) {
          ctx.fillStyle = "#111111";
          ctx.fillRect(cx, cy, cellW, cellH);
        }

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(x, y, PHOTO_W, PHOTO_H);

        if (img && srcW && srcH) {
          const base =
            fitMode === "cover"
              ? Math.max(PHOTO_W / rotW, PHOTO_H / rotH)
              : Math.min(PHOTO_W / rotW, PHOTO_H / rotH);
          const scale = base * zoom;
          const dw = srcW * scale;
          const dh = srcH * scale;
          const centerX = x + PHOTO_W / 2 + (offsetX / 100) * (PHOTO_W / 2);
          const centerY = y + PHOTO_H / 2 + (offsetY / 100) * (PHOTO_H / 2);

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, PHOTO_W, PHOTO_H);
          ctx.clip();
          ctx.translate(centerX, centerY);
          ctx.rotate(angle);
          ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        } else {
          ctx.fillStyle = "#F4F1EA";
          ctx.fillRect(x, y, PHOTO_W, PHOTO_H);
        }
      }
    }
  }, [
    img,
    sheet,
    border,
    cellW,
    cellH,
    grid,
    fitMode,
    zoom,
    offsetX,
    offsetY,
    angle,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const createExportPng = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return null;
    let exportCanvas: HTMLCanvasElement;
    try {
      exportCanvas = cropPreviewMargin(canvas);
    } catch {
      setNotification("Unable to create the PNG. Please try again.");
      return null;
    }

    const source = await new Promise<Blob | null>((resolve) => {
      exportCanvas.toBlob(resolve, "image/png");
    });
    if (!source) {
      setNotification("Unable to create the PNG. Please try again.");
      return null;
    }

    try {
      return await withPngDensity(source, DPI);
    } catch {
      setNotification("Unable to create the PNG. Please try again.");
      return null;
    }
  };

  const downloadPng = async () => {
    const png = await createExportPng();
    if (!png) return;

    const url = URL.createObjectURL(png);
    const a = document.createElement("a");
    a.href = url;
    a.download = `passport-photos-${paper}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printOrShare = async () => {
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    const fileName = `passport-photos-${paper}.png`;

    if (isMobile && navigator.share) {
      const png = await createExportPng();
      if (!png) return;

      const file = new File([png], fileName, { type: "image/png" });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }

      const url = URL.createObjectURL(png);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotification(
        "Sharing is unavailable here. The PNG was downloaded instead.",
      );
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setNotification(
        "Your browser blocked the print window. Please allow pop-ups and try again.",
      );
      return;
    }

    const png = await createExportPng();
    if (!png) {
      printWindow.close();
      return;
    }

    const exportWidthMm =
      (canvasRef.current!.width - Math.round(OUTER_MARGIN) * 2) / PIXELS_PER_MM;
    const exportHeightMm =
      (canvasRef.current!.height - Math.round(OUTER_MARGIN) * 2) /
      PIXELS_PER_MM;
    const url = URL.createObjectURL(png);
    printWindow.document.write(
      `<!doctype html><html><head><title>Passport photo sheet</title><style>@page { size: ${exportWidthMm}mm ${exportHeightMm}mm; margin: 0; } html, body { margin: 0; padding: 0; } img { display: block; width: ${exportWidthMm}mm; height: ${exportHeightMm}mm; }</style></head><body><img src="${url}" alt="Passport photo sheet"></body></html>`,
    );
    printWindow.document.close();
    printWindow.onafterprint = () => {
      URL.revokeObjectURL(url);
      printWindow.close();
    };
    window.setTimeout(() => printWindow.print(), 250);
  };

  const changePaper = (v: SheetKey) => {
    setPaper(v);
    setPerSheet(SHEETS[v].maxPhotos);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
        <header className="mb-10">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-accent" />
            300 DPI · runs entirely in your browser
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            Passport Photo Sheet Builder
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Arrange 35x45mm photos onto 4x6 or A4 sheets instantly.
          </p>
        </header>

        {notification && (
          <div
            role="status"
            className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground"
          >
            <span>{notification}</span>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setNotification(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
          {/* Controls */}
          <section className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
            />
            <button
              type="button"
              aria-label="Upload a JPG or PNG photo"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void loadFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
                dragging
                  ? "scale-[1.01] border-accent bg-accent/10"
                  : "border-border bg-secondary/50 hover:border-accent/60 hover:bg-accent/5"
              }`}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {fileName ?? "Drop a photo here or click to upload"}
              </p>
              <p className="text-xs text-muted-foreground">
                JPG or PNG · 35x45mm crop recommended
              </p>
            </button>

            <div className="space-y-2">
              <Label id="paper-size-label">Paper size</Label>
              <Select
                value={paper}
                onValueChange={(v) => changePaper(v as SheetKey)}
              >
                <SelectTrigger
                  aria-labelledby="paper-size-label"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SHEETS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label id="photo-count-label">Photos per sheet</Label>
              <Select
                value={String(perSheet)}
                onValueChange={(v) => setPerSheet(Number(v))}
              >
                <SelectTrigger
                  aria-labelledby="photo-count-label"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHEETS[paper].counts.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n === 1 ? "photo" : "photos"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Laid out as {grid.cols} × {grid.rows}, centred on the sheet.
                {grid.count < perSheet &&
                  ` Only ${grid.count} fit at this border setting.`}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label id="column-gap-label">Preferred column gap</Label>
                <span className="font-display text-sm tabular-nums text-muted-foreground">
                  {(grid.columnGap / PIXELS_PER_MM).toFixed(1)}mm
                </span>
              </div>
              <Slider
                min={0}
                max={60}
                step={1}
                aria-labelledby="column-gap-label"
                value={[columnSpacing]}
                onValueChange={(v) => setColumnSpacing(v[0] ?? columnSpacing)}
              />
              <p className="text-xs text-muted-foreground">
                4mm outer margins and a 1mm row gap are always maintained.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label id="cutting-guide-label">Cutting guide thickness</Label>
                <span className="font-display text-sm tabular-nums text-muted-foreground">
                  {border}px
                </span>
              </div>
              <Slider
                min={0}
                max={12}
                step={1}
                aria-labelledby="cutting-guide-label"
                value={[border]}
                onValueChange={(v) => setBorder(v[0] ?? border)}
              />
              <p className="text-xs text-muted-foreground">
                Drawn outside the photo — the image stays exactly 35×45mm.
              </p>
            </div>

            {img && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-4">
                <div className="flex items-center justify-between">
                  <Label id="straighten-label">Straighten</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {rotation > 0
                      ? `+${rotation.toFixed(1)}`
                      : rotation.toFixed(1)}
                    °
                  </span>
                </div>
                <Slider
                  min={-15}
                  max={15}
                  step={0.1}
                  aria-labelledby="straighten-label"
                  value={[rotation]}
                  onValueChange={(v) => setRotation(v[0] ?? rotation)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setQuarter((q) => (q + 3) % 4)}
                  >
                    <RotateCcw className="size-4" />
                    90° left
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setQuarter((q) => (q + 1) % 4)}
                  >
                    <RotateCw className="size-4" />
                    90° right
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setRotation(0);
                    setQuarter(0);
                    setZoom(1);
                    setOffsetX(0);
                    setOffsetY(0);
                  }}
                >
                  Reset rotation & crop
                </Button>
              </div>
            )}

            {img && (
              <div className="space-y-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
                <p className="text-xs text-muted-foreground">
                  Your photo isn&apos;t 35×45mm. Choose how to fit it, then
                  fine-tune the crop.
                </p>
                <div className="space-y-2">
                  <Label id="fit-mode-label">Fit mode</Label>
                  <Select
                    value={fitMode}
                    onValueChange={(v) => setFitMode(v as "cover" | "contain")}
                  >
                    <SelectTrigger
                      aria-labelledby="fit-mode-label"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">
                        Crop to fill (35×45mm)
                      </SelectItem>
                      <SelectItem value="contain">
                        Fit whole photo (white edges)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label id="zoom-label">Zoom</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {zoom.toFixed(2)}×
                    </span>
                  </div>
                  <Slider
                    min={0.5}
                    max={3}
                    step={0.01}
                    aria-labelledby="zoom-label"
                    value={[zoom]}
                    onValueChange={(v) => setZoom(v[0] ?? zoom)}
                  />
                </div>
                <div className="space-y-2">
                  <Label id="horizontal-position-label">
                    Horizontal position
                  </Label>
                  <Slider
                    min={-100}
                    max={100}
                    step={1}
                    aria-labelledby="horizontal-position-label"
                    value={[offsetX]}
                    onValueChange={(v) => setOffsetX(v[0] ?? offsetX)}
                  />
                </div>
                <div className="space-y-2">
                  <Label id="vertical-position-label">Vertical position</Label>
                  <Slider
                    min={-100}
                    max={100}
                    step={1}
                    aria-labelledby="vertical-position-label"
                    value={[offsetY]}
                    onValueChange={(v) => setOffsetY(v[0] ?? offsetY)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setZoom(1);
                    setOffsetX(0);
                    setOffsetY(0);
                  }}
                >
                  Reset crop
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Photos on this sheet
              </span>
              <span className="font-display font-semibold text-foreground">
                {grid.count}
              </span>
            </div>

            <div className="space-y-2">
              <Button
                className="w-full"
                size="lg"
                disabled={!img}
                onClick={() => void printOrShare()}
              >
                <Printer className="size-4" />
                Print / Share PNG
              </Button>
              <Button
                className="w-full"
                size="lg"
                variant="outline"
                disabled={!img}
                onClick={() => void downloadPng()}
              >
                <FileImage className="size-4" />
                Download PNG (lossless)
              </Button>
            </div>
          </section>

          {/* Preview */}
          <section
            ref={previewRef}
            className="rounded-2xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="size-4" />
              Live preview — {sheet.w} × {sheet.h} px @ {DPI} DPI
            </div>
            <div className="flex items-center justify-center rounded-xl bg-secondary/60 p-4">
              <canvas
                ref={canvasRef}
                className="max-h-[70vh] w-auto max-w-full rounded-md shadow-md ring-1 ring-border"
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
