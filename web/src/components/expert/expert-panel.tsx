'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DAGView } from './dag-view';
import { EventStream } from './event-stream';
import { EscalationPanel } from './escalation-panel';
import { WorkItemList } from './workitem-list';
import { useGateway } from '@/components/providers/gateway-provider';
import type { Goal, WorkItem } from '@/lib/types';

interface ExpertPanelProps {
  activeGoal: Goal | null;
  activeWorkItems: WorkItem[];
}

export function ExpertPanel({ activeGoal, activeWorkItems }: ExpertPanelProps) {
  const { state, respondToEscalation } = useGateway();

  return (
    <div className="h-full flex flex-col border-l bg-muted/30">
      <div className="p-3 border-b">
        <h2 className="text-sm font-semibold">Expert Panel</h2>
      </div>

      <Tabs defaultValue="dag" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2 grid grid-cols-4">
          <TabsTrigger value="dag" className="text-xs">DAG</TabsTrigger>
          <TabsTrigger value="items" className="text-xs">Items</TabsTrigger>
          <TabsTrigger value="events" className="text-xs">Events</TabsTrigger>
          <TabsTrigger value="escalations" className="text-xs relative">
            Alerts
            {state.escalations.filter((e) => e.status === 'open').length > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
            )}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden p-3">
          <TabsContent value="dag" className="h-full m-0">
            <DAGView goal={activeGoal} workItems={activeWorkItems} />
          </TabsContent>

          <TabsContent value="items" className="h-full m-0">
            <WorkItemList workItems={activeWorkItems} />
          </TabsContent>

          <TabsContent value="events" className="h-full m-0">
            <EventStream events={state.events} />
          </TabsContent>

          <TabsContent value="escalations" className="h-full m-0">
            <EscalationPanel
              escalations={state.escalations}
              onRespond={respondToEscalation}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
