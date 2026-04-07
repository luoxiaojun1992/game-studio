import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');
  
  // API 基础 URL，支持 Docker 环境
  const apiBase = env.VITE_API_BASE || 'http://localhost:3000';
  
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true
        }
      }
    },
    css: {
      preprocessorOptions: {
        less: {
          javascriptEnabled: true
        }
      }
    },
    // 定义全局常量
    define: {
      __API_BASE__: JSON.stringify(apiBase),
    }
  };
});
