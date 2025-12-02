'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function Home() {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const company = await api.companies.create({ name, domain });
      window.location.href = `/dashboard/${company._id}`;
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Taro</h1>
          <p className="text-gray-600">Voice-activated meeting assistant</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-8">
          <h2 className="text-lg font-medium mb-6">Get Started</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Company Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-taro-500 focus:border-transparent text-sm"
                placeholder="Acme Inc"
                required
              />
            </div>

            <div>
              <label htmlFor="domain" className="block text-sm font-medium text-gray-700 mb-1">
                Email Domain
              </label>
              <input
                type="text"
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-taro-500 focus:border-transparent text-sm"
                placeholder="acme.com"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Used to identify your organization
              </p>
            </div>

            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 text-white py-2 px-4 rounded-md hover:bg-gray-800 disabled:opacity-50 transition text-sm font-medium"
            >
              {loading ? 'Creating...' : 'Register'}
            </button>
          </form>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 text-center text-xs text-gray-500">
          <div>
            <div className="font-medium text-gray-700 mb-1">Voice Commands</div>
            <div>Natural language control</div>
          </div>
          <div>
            <div className="font-medium text-gray-700 mb-1">Slack Integration</div>
            <div>Post messages and tasks</div>
          </div>
          <div>
            <div className="font-medium text-gray-700 mb-1">Auto-Join</div>
            <div>Joins meetings on request</div>
          </div>
        </div>
      </div>
    </main>
  );
}
