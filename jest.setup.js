// Jest setup file
require('dotenv').config({ path: '.env.test' });

// Mock external services
jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    sendMessage: jest.fn(),
    editMessageText: jest.fn(),
    sendAudio: jest.fn(),
    deleteMessage: jest.fn(),
    answerCallbackQuery: jest.fn(),
    setMyCommands: jest.fn(),
    setWebHook: jest.fn(),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    processUpdate: jest.fn()
  }));
});

// Mock file system operations
jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
  createWriteStream: jest.fn(),
  createReadStream: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
  stat: jest.fn(),
  pathExists: jest.fn()
}));

// Global test utilities
global.createMockMessage = (text, chatId = 123456789) => ({
  message_id: Math.floor(Math.random() * 1000000),
  chat: {
    id: chatId,
    type: 'private'
  },
  from: {
    id: chatId,
    is_bot: false,
    first_name: 'Test',
    username: 'testuser'
  },
  text,
  date: Math.floor(Date.now() / 1000)
});

global.createMockCallbackQuery = (data, chatId = 123456789) => ({
  id: Math.random().toString(36),
  from: {
    id: chatId,
    is_bot: false,
    first_name: 'Test',
    username: 'testuser'
  },
  message: {
    message_id: Math.floor(Math.random() * 1000000),
    chat: {
      id: chatId,
      type: 'private'
    },
    date: Math.floor(Date.now() / 1000)
  },
  data
});

// Set test timeout
jest.setTimeout(30000);