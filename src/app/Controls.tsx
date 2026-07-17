import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function PanelSection({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel-section">
      <div className="section-heading"><h2>{title}</h2>{meta && <span>{meta}</span>}</div>
      {children}
    </section>
  );
}

export function Slider({ label, value, display, ...props }: { label: string; value: number; display?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value">) {
  return (
    <label className="control slider-control">
      <span>{label}</span>
      <output>{display ?? Number(value).toFixed(2)}</output>
      <input type="range" value={value} {...props} />
    </label>
  );
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="control"><span>{label}</span><input {...props} /></label>;
}

export function SelectField({ label, children, ...props }: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className="control"><span>{label}</span><select {...props}>{children}</select></label>;
}

export function IconButton({ label, children, active, ...props }: { label: string; children: ReactNode; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`icon-button ${active ? "is-active" : ""}`} title={label} aria-label={label} {...props}>{children}</button>;
}
