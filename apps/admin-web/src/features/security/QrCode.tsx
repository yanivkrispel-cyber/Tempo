import qrcode from "qrcode-generator";
import { useMemo } from "react";
import styles from "./security.module.css";

/**
 * A QR code as inline SVG: one path of dark modules over the card's surface, with the four-module quiet zone the
 * standard asks for. Error correction M fits an otpauth URI in a version a phone camera reads at this size.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    }
    return { size: count + 8, path: d };
  }, [value]);

  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
