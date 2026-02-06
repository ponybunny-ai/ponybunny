'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from './status-badge';
import type { WorkItem } from '@/lib/types';

interface WorkItemListProps {
  workItems: WorkItem[];
  title?: string;
}

export function WorkItemList({ workItems, title = 'Work Items' }: WorkItemListProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          {title}
          <span className="text-xs text-muted-foreground font-normal">
            {workItems.length} items
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-2">
            {workItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No work items yet...</p>
            ) : (
              workItems.map((item) => (
                <WorkItemCard key={item.id} item={item} />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function WorkItemCard({ item }: { item: WorkItem }) {
  return (
    <div className="p-2 rounded-md border bg-card text-card-foreground">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">{item.item_type}</p>
        </div>
        <StatusBadge status={item.status} size="sm" />
      </div>
      {item.dependencies.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          Depends on: {item.dependencies.length} item(s)
        </p>
      )}
    </div>
  );
}
