'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Escalation } from '@/lib/types';

interface EscalationPanelProps {
  escalations: Escalation[];
  onRespond: (escalationId: string, action: string, data?: Record<string, unknown>) => Promise<void>;
}

export function EscalationPanel({ escalations, onRespond }: EscalationPanelProps) {
  const openEscalations = escalations.filter((e) => e.status === 'open');

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          Escalations
          {openEscalations.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {openEscalations.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-2">
            {openEscalations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No pending escalations</p>
            ) : (
              openEscalations.map((escalation) => (
                <EscalationCard
                  key={escalation.id}
                  escalation={escalation}
                  onRespond={onRespond}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function EscalationCard({
  escalation,
  onRespond,
}: {
  escalation: Escalation;
  onRespond: (escalationId: string, action: string, data?: Record<string, unknown>) => Promise<void>;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const severityColor = getSeverityColor(escalation.severity);

  const handleRespond = async (action: string, data?: Record<string, unknown>) => {
    setIsSubmitting(true);
    try {
      await onRespond(escalation.id, action, data);
      setIsDialogOpen(false);
      setUserInput('');
    } catch (error) {
      console.error('Failed to respond to escalation:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className={`p-3 rounded-md border-l-4 ${severityColor} bg-card`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <WarningIcon className="h-4 w-4 text-orange-500 shrink-0" />
              <p className="text-sm font-medium truncate">{escalation.title}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {escalation.description}
            </p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            {escalation.escalation_type}
          </Badge>
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="default" onClick={() => setIsDialogOpen(true)}>
            Respond
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRespond('skip')}
            disabled={isSubmitting}
          >
            Skip
          </Button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{escalation.title}</DialogTitle>
            <DialogDescription>{escalation.description}</DialogDescription>
          </DialogHeader>

          {escalation.context_data?.required_input && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Required Input:</p>
              <ul className="text-sm text-muted-foreground list-disc list-inside">
                {escalation.context_data.required_input.map((input, i) => (
                  <li key={i}>{input}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <Input
              placeholder="Enter your response..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleRespond('user_input', { input: userInput })}
              disabled={isSubmitting || !userInput.trim()}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getSeverityColor(severity: Escalation['severity']): string {
  switch (severity) {
    case 'critical':
      return 'border-l-red-600';
    case 'high':
      return 'border-l-orange-500';
    case 'medium':
      return 'border-l-yellow-500';
    case 'low':
      return 'border-l-blue-500';
    default:
      return 'border-l-border';
  }
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}
