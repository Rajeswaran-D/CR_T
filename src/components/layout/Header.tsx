import React, { useState } from 'react';
import { ShieldCheck, Server, Check, X, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getStorageConfig, setCustomBackendUrl } from '../../services/storageContract';

interface HeaderProps {
  onOpenTestsModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTestsModal: _onOpenTestsModal }) => {
  const { activeRole, backendStatus } = useApp();
  const [showBackendModal, setShowBackendModal] = useState(false);
  const currentConfig = getStorageConfig();
  const [customUrlInput, setCustomUrlInput] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('cft_backend_api_url') || '' : ''
  );
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const testConnection = async (urlToTest: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const base = (urlToTest || currentConfig.apiBaseUrl).replace(/\/$/, '');
      const res = await fetch(`${base}/health`, {
        headers: { 'X-Organization-Id': currentConfig.organizationId }
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestResult({
          success: true,
          msg: `Online (${data.storageProvider || 'connected'})`
        });
      } else {
        setTestResult({
          success: false,
          msg: `HTTP Error ${res.status}: Backend reachable but returned error.`
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `Connection failed: ${err.message || 'Cannot reach URL'}`
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveBackendUrl = () => {
    setCustomBackendUrl(customUrlInput);
    setShowBackendModal(false);
    window.location.reload();
  };

  const handleResetDefault = () => {
    setCustomBackendUrl('');
    setCustomUrlInput('');
    setShowBackendModal(false);
    window.location.reload();
  };

  return (
    <>
      <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between text-slate-800 select-none z-20 shadow-xs">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center font-black text-white tracking-widest text-xs shadow-xs">
            CFT
          </div>
          <span className="font-black tracking-tight text-slate-900 text-lg">
            CIRCOR
          </span>
        </div>

        {/* Right Controls: Backend Sync Badge + Active Role Badge */}
        <div className="flex items-center gap-3">
          {/* Backend Connectivity Status Button */}
          <button
            onClick={() => setShowBackendModal(true)}
            title="Click to view/configure Backend API endpoint"
            className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 shadow-2xs transition-colors cursor-pointer text-left"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                backendStatus === 'offline'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-500 ring-2 ring-emerald-200'
              }`}
            />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Backend API:</span>
              <span className="text-xs font-semibold text-slate-700 leading-tight mt-0.5">
                {backendStatus === 'offline' ? 'Offline Cache' : 'Live Connected'}
              </span>
            </div>
          </button>

          {/* Active Role Badge */}
          <div className="flex items-center gap-2.5 bg-emerald-50/80 border border-emerald-200 rounded-lg px-3.5 py-1.5 text-emerald-900 shadow-2xs">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Role:</span>
                <span className="text-xs font-bold text-emerald-950">{activeRole}</span>
              </div>
              <span className="text-[9px] text-emerald-700 font-mono leading-none mt-0.5">
                Role-Based Milestone Access
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Backend API Configuration Modal */}
      {showBackendModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-5 text-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <Server className="w-5 h-5 text-emerald-600" />
                Backend API Connection
              </div>
              <button
                onClick={() => setShowBackendModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-sm">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Current Active Endpoint:
                </label>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 break-all flex items-center justify-between gap-2">
                  <span>{currentConfig.apiBaseUrl}</span>
                  <span
                    className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full ${
                      backendStatus === 'offline'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {backendStatus === 'offline' ? 'Offline' : 'Connected'}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Custom Backend URL (Render or Cloud):
                </label>
                <input
                  type="text"
                  value={customUrlInput}
                  onChange={e => setCustomUrlInput(e.target.value)}
                  placeholder="e.g. https://circor-tracker-api.onrender.com/api"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Leave blank to use default (<code>/api</code> routed via Vercel reverse proxy).
                </p>
              </div>

              {testResult && (
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {testResult.success ? <Check className="w-4 h-4 shrink-0 text-emerald-600" /> : <X className="w-4 h-4 shrink-0 text-rose-600" />}
                  <span>{testResult.msg}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-2">
              <button
                type="button"
                onClick={() => testConnection(customUrlInput)}
                disabled={testing}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetDefault}
                  className="px-3 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-medium cursor-pointer"
                >
                  Reset Default
                </button>
                <button
                  type="button"
                  onClick={handleSaveBackendUrl}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Apply & Reload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
