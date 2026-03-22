import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../src/lib/utils';

type DockItem = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  badge?: number; // Optional badge count
};

interface DockProps {
  items: DockItem[];
  className?: string;
  activeLabel?: string;
}

export const Dock: React.FC<DockProps> = ({ items, className, activeLabel }) => {
  return (
    <div
      className={cn(
        'pointer-events-none',
        className
      )}
    >
      <div className="mx-auto max-w-md">
        <div className="pointer-events-auto border-t border-border bg-card/95 backdrop-blur-md pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center justify-around">
            {items.map(({ icon: Icon, label, onClick, badge }) => {
              const isActive = activeLabel === label;
              const isCreate = label === 'Create';
              return (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className={cn(
                    'relative flex flex-1 flex-col items-center gap-0.5 py-3 text-[10px] font-medium transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-label={label}
                >
                  {isCreate ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-foreground">
                      <Icon size={18} />
                    </div>
                  ) : (
                    <div className="relative">
                      <Icon
                        size={24}
                        className={cn(
                          'transition-all duration-150',
                          isActive ? 'scale-105' : ''
                        )}
                      />
                      {badge && badge > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                      {isActive && (
                        <motion.div
                          layoutId="dock-active-dot"
                          className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground"
                          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
