'use client';

import { useState, useEffect } from 'react';
import { Save, RotateCcw, AlertCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CodeEditor } from '@/components/ui/code-editor';
import { toast } from 'sonner';

const CONFIG_FILES = [
  { id: 'credentials.json', label: 'Credentials' },
  { id: 'llm-config.json', label: 'LLM Config' },
  { id: 'mcp-config.json', label: 'MCP Config' },
];

export default function ConfigPage() {
  const [activeFile, setActiveFile] = useState(CONFIG_FILES[0].id);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = async (file: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/config?file=${file}`);
      const data = await response.json();
      
      if (response.ok) {
        const formatted = JSON.stringify(data.content, null, 2);
        setContent(formatted);
        setOriginalContent(formatted);
      } else {
        setError(data.error || 'Failed to load config');
        toast.error('Failed to load configuration');
      }
    } catch (err) {
      console.error('Error fetching config:', err);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig(activeFile);
  }, [activeFile]);

  const handleSave = async () => {
    try {
      // Validate JSON
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        toast.error('Invalid JSON format');
        return;
      }

      setSaving(true);
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: activeFile,
          content: parsed
        }),
      });

      if (response.ok) {
        toast.success('Configuration saved successfully');
        setOriginalContent(content);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      console.error('Error saving config:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setContent(originalContent);
    toast.info('Changes discarded');
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="p-8 max-w-5xl mx-auto h-full flex flex-col">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground mt-2">Manage system configuration files</p>
      </div>

      <Tabs value={activeFile} onValueChange={setActiveFile} className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            {CONFIG_FILES.map((file) => (
              <TabsTrigger key={file.id} value={file.id}>
                {file.label}
              </TabsTrigger>
            ))}
          </TabsList>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleReset} 
              disabled={!hasChanges || loading}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Discard
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!hasChanges || loading || saving}
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {CONFIG_FILES.map((file) => (
          <TabsContent key={file.id} value={file.id} className="flex-1 mt-0 h-full">
            <Card className="h-full flex flex-col">
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-medium font-mono text-muted-foreground">
                  ~/.ponybunny/{file.id}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 relative">
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-destructive p-4">
                    <AlertCircle className="h-8 w-8 mb-2" />
                    <p>{error}</p>
                    <Button variant="outline" className="mt-4" onClick={() => fetchConfig(activeFile)}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <CodeEditor
                    value={content}
                    onChange={(value) => setContent(value || '')}
                    language="json"
                    height="100%"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
