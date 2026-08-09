"use client";
import { useRef, useState } from "react";

function valueToAngle(value, min, max) {
  const pct = (value - min) / (max - min);
  return Math.max(0, Math.min(360, pct * 360));
}
function angleToValue(angle, min, max) {
  const pct = angle / 360;
  return min + pct * (max - min);
}
function angleFromPointer(cx, cy, px, py) {
  let angle = Math.atan2(px - cx, -(py - cy)) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}
function arcPath(cx, cy, r, angleDeg) {
  if (angleDeg <= 0) return "";
  if (angleDeg >= 359.999) angleDeg = 359.999; // تفادي خلل رسم القوس عند دائرة كاملة تمامًا
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  const largeArc = angleDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`;
}

// «دائرة الصوت الأصلي» ثابتة غير قابلة للتعديل، تمثّل القيمة المستهدفة —
// و«دائرة الصوت المُولَّد» قابلة للسحب والتعديل المباشر حولها.
export default function DualCircleControl({ label, unit, min, max, step = 1, original, value, onChange, fmt }) {
  const svgRef = useRef(null);
  const dragging = useRef(false);
  const size = 132, r = 52, cx = size / 2, cy = size / 2;

  const format = (v) => (fmt ? fmt(v) : `${Math.round(v * 100) / 100}${unit || ""}`);

  const diff = typeof original === "number" ? Math.round((value - original) * 100) / 100 : null;
  const tolerance = (max - min) * 0.12;
  const matchPct = diff != null ? Math.max(0, Math.min(100, Math.round(100 - (Math.abs(diff) / tolerance) * 100))) : null;
  const matchColor = matchPct == null ? "#9AA6A3" : matchPct >= 85 ? "#1D8348" : matchPct >= 50 ? "#D4A017" : "#DC2626";

  const handleMove = (clientX, clientY) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const angle = angleFromPointer(rect.left + rect.width / 2, rect.top + rect.height / 2, clientX, clientY);
    let v = angleToValue(angle, min, max);
    v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, v)));
  };

  const onPointerDown = (e) => {
    dragging.current = true;
    const move = (ev) => {
      const p = ev.touches ? ev.touches[0] : ev;
      handleMove(p.clientX, p.clientY);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move);
    window.addEventListener("touchend", up);
    move(e);
  };

  const step1 = () => onChange(Math.max(min, Math.min(max, Math.round((value + step) / step) * step)));
  const stepDown1 = () => onChange(Math.max(min, Math.min(max, Math.round((value - step) / step) * step)));

  const origAngle = typeof original === "number" ? valueToAngle(original, min, max) : null;
  const valAngle = valueToAngle(value, min, max);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>{label}</div>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg ref={svgRef} width={size} height={size} style={{ touchAction: "none" }}>
          {/* حلقة خلفية */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E7ECEA" strokeWidth="8" />
          {/* الأصلي — ثابت، أخضر مزرق */}
          {origAngle != null && <path d={arcPath(cx, cy, r, origAngle)} fill="none" stroke="#14746F" strokeWidth="4" strokeLinecap="round" opacity=".55" />}
          {/* المُولَّد — قابل للسحب */}
          <path d={arcPath(cx, cy, r, valAngle)} fill="none" stroke={matchColor} strokeWidth="8" strokeLinecap="round" />
          {/* مقبض السحب */}
          <circle
            cx={cx + r * Math.cos(((valAngle - 90) * Math.PI) / 180)}
            cy={cy + r * Math.sin(((valAngle - 90) * Math.PI) / 180)}
            r="9" fill="#fff" stroke={matchColor} strokeWidth="3" style={{ cursor: "grab" }}
            onMouseDown={onPointerDown} onTouchStart={onPointerDown}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 11, color: "#9AA6A3" }}>المُولَّد</span>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{format(value)}</span>
          {original != null && <span style={{ fontSize: 10, color: "#5B6F6C" }}>الأصلي: {format(original)}</span>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <button onClick={stepDown1} style={circleBtn}>−</button>
        <input type="number" value={value} step={step} onChange={(e) => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || 0)))}
          style={{ width: 56, textAlign: "center", padding: 4, borderRadius: 6, border: "1px solid #DCE4DF", fontSize: 12 }} />
        <button onClick={step1} style={circleBtn}>+</button>
      </div>

      {original != null && (
        <button onClick={() => onChange(original)} style={{ marginTop: 6, fontSize: 11, color: "#14746F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
          مطابقة الأصل
        </button>
      )}

      {matchPct != null && (
        <div style={{ marginTop: 4, fontSize: 11, color: matchColor, fontWeight: 700 }}>
          {matchPct}% {matchPct >= 90 ? "— متطابق" : diff > 0 ? "▲ أعلى من الأصل" : diff < 0 ? "▼ أقلّ من الأصل" : ""}
        </div>
      )}
    </div>
  );
}

const circleBtn = { width: 22, height: 22, borderRadius: "50%", border: "1px solid #DCE4DF", background: "#fff", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" };
