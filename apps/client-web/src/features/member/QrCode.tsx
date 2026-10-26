import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code as inline SVG with the standard's four-module quiet zone. */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { modules, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    }
    return { modules: count + 8, path: d };
  }, [value]);
  return (
    <svg
      className="tp-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="var(--ink)" />
    </svg>
  );
}
