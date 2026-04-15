import React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, label, error, helperText, ...props }, ref) => {
        return (
            <div className="flex flex-col gap-1.5">
                {label && (
                    <label className="text-sm font-medium text-text-secondary">
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    className={cn(
                        "flex h-10 w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted",
                        "focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        error && "border-accent-secondary focus:ring-accent-secondary/50",
                        className
                    )}
                    onFocus={(e) => {
                        e.target.select();
                        props.onFocus?.(e);
                    }}
                    {...props}
                />
                {error && (
                    <span className="text-xs text-accent-secondary">{error}</span>
                )}
                {helperText && !error && (
                    <span className="text-[10px] text-text-muted px-1">{helperText}</span>
                )}
            </div>
        );
    }
);
