#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🤖 Music Bot Telegram Setup Script');
console.log('=====================================');

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion < 18) {
  console.error('❌ Node.js 18.0.0 or higher is required');
  console.error(`   Current version: ${nodeVersion}`);
  process.exit(1);
}

console.log(`✅ Node.js version: ${nodeVersion}`);

// Check if .env exists
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    console.log('📋 Creating .env from .env.example...');
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ .env file created');
  } else {
    console.error('❌ .env.example file not found');
    process.exit(1);
  }
} else {
  console.log('✅ .env file exists');
}

// Create directories
const dirs = ['logs', 'tmp'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  } else {
    console.log(`✅ Directory exists: ${dir}`);
  }
});

// Check if dependencies are installed
const packageJsonPath = path.join(__dirname, 'package.json');
const nodeModulesPath = path.join(__dirname, 'node_modules');

if (!fs.existsSync(nodeModulesPath)) {
  console.log('📦 Installing dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
    console.log('✅ Dependencies installed');
  } catch (error) {
    console.error('❌ Failed to install dependencies');
    console.error(error.message);
    process.exit(1);
  }
} else {
  console.log('✅ Dependencies are installed');
}

// Build the project
console.log('🔨 Building project...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
  console.log('✅ Project built successfully');
} catch (error) {
  console.error('❌ Build failed');
  console.error(error.message);
  process.exit(1);
}

console.log('');
console.log('🎉 Setup completed successfully!');
console.log('');
console.log('Next steps:');
console.log('1. Edit .env file with your configuration:');
console.log('   - TELEGRAM_BOT_TOKEN (required)');
console.log('   - API_BASE_URL (your backend API)');
console.log('   - Other optional settings');
console.log('');
console.log('2. Start the bot:');
console.log('   npm run dev    # Development mode');
console.log('   npm start      # Production mode');
console.log('');
console.log('3. Send your bot a YouTube URL to test!');
console.log('');
console.log('📚 For more information, see README.md');