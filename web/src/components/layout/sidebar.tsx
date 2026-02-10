'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Activity, Settings, Server } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  {
    href: '/chat',
    label: 'Conversation',
    icon: MessageSquare,
  },
  {
    href: '/status',
    label: 'System Status',
    icon: Activity,
  },
  {
    href: '/config',
    label: 'Configuration',
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col w-64 border-r bg-background h-screen">
      <div className="p-6 flex items-center gap-2 border-b">
        <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold">
          PB
        </div>
        <span className="font-bold text-lg">PonyBunny</span>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === '/chat' && pathname === '/');
          const Icon = item.icon;
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-primary/10 text-primary" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-2 mb-2">
          <Server className="h-3 w-3" />
          <span>v0.1.0</span>
        </div>
        <p>Autonomous AI Employee System</p>
      </div>
    </div>
  );
}
