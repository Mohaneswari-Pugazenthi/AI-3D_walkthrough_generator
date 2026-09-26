import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Navigation, RotateCcw, Box, Map, Sparkles } from 'lucide-react';
import { analyzeBlueprint, generateDemoBlueprint, type BlueprintData } from '@/lib/blueprintAnalyzer';
import { findPath, smoothPath, type PathNode } from '@/lib/pathfinding';
import Scene3D from '@/components/Scene3D';
import BlueprintPreview2D from '@/components/BlueprintPreview2D';
import TenixLogo from '@/components/TenixLogo';
import { TRAINED_MODEL_METRICS } from '@/lib/trainedModelConfig';

export default function Index() {
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [path, setPath] = useState<PathNode[]>([]);
  const [startRoom, setStartRoom] = useState<string>('');
  const [endRoom, setEndRoom] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setPath([]);
    setStartRoom('');
    setEndRoom('');
    try {
      const data = await analyzeBlueprint(file);
      if (data.rooms.length === 0) {
        setError('No rooms detected. Try a clearer blueprint or use the demo.');
      }
      setBlueprint(data);
    } catch {
      setError('Failed to analyze blueprint. Try the demo instead.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDemo = useCallback(() => {
    setPath([]);
    setStartRoom('');
    setEndRoom('');
    setError(null);
    setBlueprint(generateDemoBlueprint());
  }, []);

  const navigate = useCallback(() => {
    if (!blueprint || !startRoom || !endRoom) return;
    const start = blueprint.rooms.find(r => r.id === startRoom);
    const end = blueprint.rooms.find(r => r.id === endRoom);
    if (!start || !end) return;

    const rawPath = findPath(
      blueprint.grid,
      { x: Math.round(start.centerX), y: Math.round(start.centerY) },
      { x: Math.round(end.centerX), y: Math.round(end.centerY) }
    );

    if (rawPath.length === 0) {
      setError('No path found between these rooms.');
      setPath([]);
    } else {
      setError(null);
      setPath(smoothPath(rawPath));
    }
  }, [blueprint, startRoom, endRoom]);

  const reset = useCallback(() => {
    setBlueprint(null);
    setPath([]);
    setStartRoom('');
    setEndRoom('');
    setError(null);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <TenixLogo size="md" />
            <span className="hidden sm:inline-block h-4 w-px bg-border" />
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground bg-accent/50 px-2.5 py-1 rounded-full border border-border">
              3D Blueprint Navigator
            </span>
          </div>
          {blueprint && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="w-4 h-4 mr-1" /> Reset
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full">
        {/* Sidebar Controls */}
        <aside className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-border p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-5">
            {/* AI Model Accuracy Badge */}
            <Card className="p-3 bg-emerald-500/5 border-emerald-500/30 flex items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-foreground">AI Model Calibrated</div>
                  <div className="text-[10px] text-muted-foreground">Trained on 1,000+ Blueprint Layouts</div>
                </div>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                {TRAINED_MODEL_METRICS.accuracyPercent}% Acc
              </span>
            </Card>

            {/* Upload Section */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Blueprint Input
              </h2>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:bg-accent/50 transition-colors group">
                <Upload className="w-8 h-8 text-muted-foreground mb-2 group-hover:text-primary transition-colors" />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Upload JPG/PNG</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
              <div className="text-center text-xs text-muted-foreground">or</div>
              <Button variant="outline" className="w-full" onClick={loadDemo} disabled={loading}>
                <Sparkles className="w-4 h-4 mr-1" style={{ color: '#12E700' }} /> Load Demo Blueprint
              </Button>
            </Card>

            {/* DETECTED ROOMS Card (Reference Image 2) */}
            {blueprint && blueprint.rooms.length > 0 && (
              <Card className="p-4 space-y-3 border-border/80 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    Detected Rooms
                    <span className="text-[10px] bg-accent px-1.5 py-0.5 rounded-full font-bold text-foreground">
                      {blueprint.rooms.length}
                    </span>
                  </h2>
                  <span className="text-[10px] text-muted-foreground">Click pill to set start</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {blueprint.rooms.map((room) => {
                    const isStart = startRoom === room.id;
                    const isEnd = endRoom === room.id;
                    return (
                      <button
                        key={room.id}
                        onClick={() => {
                          if (!startRoom || (startRoom && endRoom)) {
                            setStartRoom(room.id);
                            if (endRoom === room.id) setEndRoom('');
                          } else if (startRoom && !endRoom && room.id !== startRoom) {
                            setEndRoom(room.id);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95 ${isStart || isEnd
                          ? 'ring-2 ring-foreground/20 font-extrabold shadow-md'
                          : 'hover:brightness-95'
                          }`}
                        style={{
                          borderColor: room.borderColor || '#94a3b8',
                          color: room.borderColor || '#0f172a',
                          backgroundColor: `${room.color}44`,
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: room.borderColor || '#3b82f6' }}
                        />
                        {room.name}
                        {isStart && <span className="text-[9px] bg-slate-900 text-white px-1.5 py-0.5 rounded-full font-bold ml-1">START</span>}
                        {isEnd && <span className="text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-bold ml-1">END</span>}
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Navigation Controls */}
            {blueprint && blueprint.rooms.length > 0 && (
              <Card className="p-4 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Navigation
                </h2>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Start Room</label>
                  <Select value={startRoom} onValueChange={setStartRoom}>
                    <SelectTrigger><SelectValue placeholder="Select start" /></SelectTrigger>
                    <SelectContent>
                      {blueprint.rooms.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Destination</label>
                  <Select value={endRoom} onValueChange={setEndRoom}>
                    <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                    <SelectContent>
                      {blueprint.rooms.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={navigate}
                  disabled={!startRoom || !endRoom || startRoom === endRoom}
                >
                  <Navigation className="w-4 h-4 mr-1" /> Navigate
                </Button>
              </Card>
            )}

            {/* View toggle */}
            {blueprint && (
              <Card className="p-4">
                <div className="flex gap-2">
                  <Button
                    variant={view === '3d' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setView('3d')}
                  >
                    <Box className="w-4 h-4 mr-1" /> 3D
                  </Button>
                  <Button
                    variant={view === '2d' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setView('2d')}
                  >
                    <Map className="w-4 h-4 mr-1" /> 2D
                  </Button>
                </div>
              </Card>
            )}

            {/* Info */}
            {blueprint && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Grid: {blueprint.width}×{blueprint.height}</p>
                <p>Rooms: {blueprint.rooms.length}</p>
                {path.length > 0 && <p>Path length: {path.length} steps</p>}
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {loading && (
              <p className="text-sm text-muted-foreground animate-pulse">Analyzing blueprint...</p>
            )}
          </div>

          {/* Footer Branding */}
          <div className="pt-4 border-t border-border/50 text-center">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              Powered by TENIX AI
            </span>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 p-4 min-h-[400px] lg:min-h-0">
          {blueprint ? (
            view === '3d' ? (
              <Scene3D
                blueprint={blueprint}
                path={path}
              />
            ) : (
              <BlueprintPreview2D blueprint={blueprint} path={path} />
            )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground space-y-6 min-h-[450px] bg-card/30 rounded-xl border border-border/50 p-8 shadow-inner">
              <div className="p-6 rounded-2xl bg-card border border-border shadow-lg transition-transform hover:scale-105 duration-300">
                <TenixLogo size="xl" />
              </div>
              <div className="text-center space-y-2 max-w-md">
                <h3 className="text-xl font-bold text-foreground">Interactive 3D Blueprint Navigator</h3>
                <p className="text-sm text-muted-foreground">
                  Transform any 2D architectural blueprint image into an immersive 3D space with real-time pathfinding navigation.
                </p>
              </div>
              <Button size="lg" onClick={loadDemo} className="mt-2 font-medium">
                <Sparkles className="w-4 h-4 mr-2" /> Launch Demo View
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
