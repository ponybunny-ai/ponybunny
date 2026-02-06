'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from './status-badge';
import type { Goal, WorkItem } from '@/lib/types';

interface DAGViewProps {
  goal: Goal | null;
  workItems: WorkItem[];
}

interface DAGNode {
  item: WorkItem;
  level: number;
  column: number;
}

export function DAGView({ goal, workItems }: DAGViewProps) {
  // Build DAG layout
  const { nodes, maxLevel, maxColumn } = useMemo(() => {
    if (workItems.length === 0) {
      return { nodes: [], maxLevel: 0, maxColumn: 0 };
    }

    // Create a map for quick lookup
    const itemMap = new Map<string, WorkItem>();
    workItems.forEach((wi) => itemMap.set(wi.id, wi));

    // Calculate levels (topological sort)
    const levels = new Map<string, number>();
    const visited = new Set<string>();

    function calculateLevel(id: string): number {
      if (levels.has(id)) return levels.get(id)!;
      if (visited.has(id)) return 0; // Cycle detection

      visited.add(id);
      const item = itemMap.get(id);
      if (!item) return 0;

      let maxDepLevel = 0;
      for (const depId of item.dependencies) {
        maxDepLevel = Math.max(maxDepLevel, calculateLevel(depId) + 1);
      }

      levels.set(id, maxDepLevel);
      return maxDepLevel;
    }

    workItems.forEach((wi) => calculateLevel(wi.id));

    // Group by level
    const levelGroups = new Map<number, WorkItem[]>();
    workItems.forEach((wi) => {
      const level = levels.get(wi.id) || 0;
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level)!.push(wi);
    });

    // Create nodes with positions
    const dagNodes: DAGNode[] = [];
    let maxLvl = 0;
    let maxCol = 0;

    levelGroups.forEach((items, level) => {
      items.forEach((item, column) => {
        dagNodes.push({ item, level, column });
        maxLvl = Math.max(maxLvl, level);
        maxCol = Math.max(maxCol, column);
      });
    });

    return { nodes: dagNodes, maxLevel: maxLvl, maxColumn: maxCol };
  }, [workItems]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium">DAG View</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-4 overflow-auto">
        {!goal ? (
          <p className="text-sm text-muted-foreground">No active goal</p>
        ) : nodes.length === 0 ? (
          <div className="space-y-3">
            <GoalNode goal={goal} />
            <p className="text-sm text-muted-foreground text-center">No work items yet...</p>
          </div>
        ) : (
          <div className="space-y-3">
            <GoalNode goal={goal} />
            <div
              className="relative"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${maxColumn + 1}, minmax(120px, 1fr))`,
                gridTemplateRows: `repeat(${maxLevel + 1}, auto)`,
                gap: '12px',
              }}
            >
              {nodes.map((node) => (
                <div
                  key={node.item.id}
                  style={{
                    gridColumn: node.column + 1,
                    gridRow: node.level + 1,
                  }}
                >
                  <WorkItemNode item={node.item} />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalNode({ goal }: { goal: Goal }) {
  return (
    <div className="p-3 rounded-lg border-2 border-primary bg-primary/5 text-center">
      <p className="text-sm font-medium truncate">{goal.title}</p>
      <div className="mt-1">
        <StatusBadge status={goal.status} size="sm" />
      </div>
    </div>
  );
}

function WorkItemNode({ item }: { item: WorkItem }) {
  const borderColor = getStatusBorderColor(item.status);

  return (
    <div className={`p-2 rounded-md border-2 ${borderColor} bg-card`}>
      <p className="text-xs font-medium truncate">{item.title}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-muted-foreground">{item.item_type}</span>
        <StatusBadge status={item.status} size="sm" />
      </div>
    </div>
  );
}

function getStatusBorderColor(status: WorkItem['status']): string {
  switch (status) {
    case 'done':
      return 'border-green-500';
    case 'in_progress':
      return 'border-blue-500';
    case 'failed':
      return 'border-red-500';
    case 'blocked':
      return 'border-orange-500';
    case 'verify':
      return 'border-purple-500';
    default:
      return 'border-border';
  }
}
