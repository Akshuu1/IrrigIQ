// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TelegramConnectCard } from './TelegramConnectCard.js';
import { api, type MessageChannel } from '../api/client.js';
import '../locales/i18n.js';

describe('TelegramConnectCard Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders disconnected state with Connect Telegram button when user has no channel', async () => {
    vi.spyOn(api, 'getMessagingChannel').mockResolvedValue(null);

    render(<TelegramConnectCard />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).toBeNull();
    });

    expect(screen.getByText(/Not Connected/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Connect Telegram/i })).toBeTruthy();
  });

  it('generates link code and displays deep link button when Connect Telegram is clicked', async () => {
    vi.spyOn(api, 'getMessagingChannel').mockResolvedValue(null);
    vi.spyOn(api, 'createLinkCode').mockResolvedValue({
      code: '849201',
      deepLink: 'https://t.me/IrrigIQBot?start=849201',
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    });

    render(<TelegramConnectCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect Telegram/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/i }));

    await waitFor(() => {
      expect(screen.getByText('849201')).toBeTruthy();
      expect(screen.getByText(/Open in Telegram/i)).toBeTruthy();
    });
  });

  it('renders preferences and active status when Telegram channel is connected', async () => {
    const mockChannel: MessageChannel = {
      userId: 'user123',
      provider: 'telegram',
      status: 'active',
      optedIn: true,
      sendTime: '06:30',
      quietHours: {
        start: '22:00',
        end: '06:00',
      },
      dailyCap: 3,
      messagesSentToday: 1,
    };

    vi.spyOn(api, 'getMessagingChannel').mockResolvedValue(mockChannel);
    vi.spyOn(api, 'sendTestMessage').mockResolvedValue();

    render(<TelegramConnectCard />);

    await waitFor(() => {
      expect(screen.getByText(/Connected & Active/i)).toBeTruthy();
    });

    expect(screen.getByText(/Save Preferences/i)).toBeTruthy();
    expect(screen.getByText(/Send Test Advisory/i)).toBeTruthy();
    expect(screen.getByText(/Disconnect Telegram/i)).toBeTruthy();

    // Click test message
    fireEvent.click(screen.getByText(/Send Test Advisory/i));

    await waitFor(() => {
      expect(api.sendTestMessage).toHaveBeenCalled();
    });
  });
});
