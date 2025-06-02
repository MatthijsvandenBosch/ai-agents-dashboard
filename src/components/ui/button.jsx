import * as React from "react";

export const Button = React.forwardRef(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles = "rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2";
    
    const variantStyles = {
      default: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
      outline: "border border-gray-300 bg-transparent hover:bg-gray-50 active:bg-gray-100"
    };
    
    const sizeStyles = {
      default: "px-4 py-2 text-sm",
      sm: "px-2 py-1 text-xs"
    };
    
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className || ""}`}
        {...props}
      />
    );
  }
);
