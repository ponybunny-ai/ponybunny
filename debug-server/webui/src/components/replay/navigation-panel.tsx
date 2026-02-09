'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, ChevronRight, Bookmark } from 'lucide-react';
import type { DebugEvent } from '@/lib/types';
import { categorizeEvent } from '@/lib/types';

interface NavigationPanelProps {
  events: DebugEvent[];
  currentEventIndex: number;
  onJumpToEvent: (index: number) => void;
  onJumpToNextError: () => void;
  onJumpToNextPhase: () => void;
  onJumpToNextLLM: () => void;
}

export function NavigationPanel({
  events,
  currentEventIndex,
  onJumpToEvent,
  onJumpToNextError,
  onJumpToNextPhase,
  onJumpToNextLLM,
}: NavigationPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());

  const eventCategories = ['goal', 'workitem', 'run', 'llm', 'tool', 'state'];

  const toggleFilter = (category: string) => {
    const newFilters = new Set(selectedFilters);
    if (newFilters.has(category)) {
      newFilters.delete(category);
    } else {
      newFilters.add(category);
    }
    setSelectedFilters(newFilters);
  };

  const toggleBookmark = (index: number) => {
    const newBookmarks = new Set(bookmarks);
    if (newBookmarks.has(index)) {
      newBookmarks.delete(index);
    } else {
      newBookmarks.add(index);
    }
    setBookmarks(newBookmarks);
  };

  const filteredEvents = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!event.type.toLowerCase().includes(query) &&
            !JSON.stringify(event.data).toLowerCase().includes(query)) {
          return false;
        }
      }

      // Category filter
      if (selectedFilters.size > 0) {
        const category = categorizeEvent(event.type);
        if (!selectedFilters.has(category)) {
          return false;
        }
      }

      return true;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Navigation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Quick Jump Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onJumpToNextError}
            className="text-xs"
          >
            Next Error
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onJumpToNextPhase}
            className="text-xs"
          >
            Next Phase
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onJumpToNextLLM}
            className="text-xs"
          >
            Next LLM
          </Button>
        </div>

        {/* Category Filters */}
        <div>
          <div className="text-sm font-medium mb-2">Filters</div>
          <div className="flex flex-wrap gap-2">
            {eventCategories.map((category) => (
              <Badge
                key={category}
                variant={selectedFilters.has(category) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleFilter(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
        </div>

        {/* Bookmarks */}
        {bookmarks.size > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">
              Bookmarks ({bookmarks.size})
            </div>
            <div className="space-y-1 max-h-32 overflow-auto">
              {Array.from(bookmarks)
                .sort((a, b) => a - b)
                .map((index) => {
                  const event = events[index];
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent"
                      onClick={() => onJumpToEvent(index)}
                    >
                      <Bookmark className="h-3 w-3 fill-current" />
                      <span className="text-xs truncate flex-1">{event.type}</span>
                      <ChevronRight className="h-3 w-3" />
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Filtered Events List */}
        <div>
          <div className="text-sm font-medium mb-2">
            Events ({filteredEvents.length}/{events.length})
          </div>
          <div className="space-y-1 max-h-96 overflow-auto">
            {filteredEvents.map(({ event, index }) => (
              <div
                key={index}
                className={`flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent ${
                  index === currentEventIndex ? 'bg-accent' : ''
                }`}
                onClick={() => onJumpToEvent(index)}
              >
                <Badge variant="outline" className="text-xs">
                  {categorizeEvent(event.type)}
                </Badge>
                <span className="text-xs truncate flex-1">{event.type}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookmark(index);
                  }}
                  className="p-1"
                >
                  <Bookmark
                    className={`h-3 w-3 ${bookmarks.has(index) ? 'fill-current' : ''}`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
