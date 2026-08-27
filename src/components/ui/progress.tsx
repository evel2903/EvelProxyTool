import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indicatorClassName?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'gradient';
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, variant = 'default', indicatorClassName, ...props }, ref) => {
    const percentage = Math.min(Math.max(0, (value / max) * 100), 100);

    const variantStyles = {
      default: 'bg-primary',
      success: 'bg-emerald-500 dark:bg-emerald-400',
      warning: 'bg-amber-500 dark:bg-amber-400',
      danger: 'bg-rose-500 dark:bg-rose-400',
      gradient: 'bg-gradient-to-r from-sky-500 via-cyan-400 to-teal-400',
    };

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-secondary/70 dark:bg-slate-800/80',
          className
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full w-full flex-1 transition-all duration-300 ease-out',
            variantStyles[variant],
            indicatorClassName
          )}
          style={{ transform: `translateX(-${100 - percentage}%)` }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';

export { Progress };
