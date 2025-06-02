import * as React from "react";

export function Select({ value, onValueChange, children }) {
  return (
    <select
      className="border rounded px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  );
}

export function SelectTrigger({ children }) {
  return children;
}

export function SelectContent({ children }) {
  return children;
}

export function SelectItem({ value, children }) {
  return <option value={value}>{children}</option>;
}
