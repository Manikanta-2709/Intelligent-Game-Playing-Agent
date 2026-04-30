/* ============================================================
   BOARD GAMES HUB — PWA INITIALIZER
   Service Worker registration and PWA features
   ============================================================ */

(function() {
  'use strict';

  // Check for Service Worker support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/static/js/sw.js')
        .then(function(registration) {
          console.log('ServiceWorker registered:', registration.scope);
          
          // Check for updates
          registration.addEventListener('updatefound', function() {
            const newWorker = registration.installing;
            console.log('ServiceWorker update found');
            
            newWorker.addEventListener('statechange', function() {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker available
                showUpdateNotification();
              }
            });
          });
        })
        .catch(function(error) {
          console.log('ServiceWorker registration failed:', error);
        });
    });
  }

  // Show update notification
  function showUpdateNotification() {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <span>🔄 A new version is available!</span>
      <button onclick="window.location.reload()">Update Now</button>
    `;
    document.body.appendChild(notification);
    
    // Style the notification
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 1000;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease-out;
    `;
    
    const button = notification.querySelector('button');
    button.style.cssText = `
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.2s;
    `;
    
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255,255,255,0.3)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(255,255,255,0.2)';
    });
  }

  // Add CSS animation for notification
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // Request notification permission
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      // Ask user after they interact with the page
      document.addEventListener('click', function askOnce() {
        Notification.requestPermission();
        document.removeEventListener('click', askOnce);
      }, { once: true });
    }
  }

  // Check for notification permission on load
  window.addEventListener('load', requestNotificationPermission);

  // Offline detection
  function handleOnline() {
    console.log('Connection restored');
    // Trigger background sync if available
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      navigator.serviceWorker.ready.then(function(registration) {
        registration.sync.register('sync-moves');
      });
    }
  }

  function handleOffline() {
    console.log('Connection lost - offline mode');
    showOfflineNotification();
  }

  function showOfflineNotification() {
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
      <span>📡 You're offline - some features may be limited</span>
    `;
    document.body.appendChild(notification);
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(245, 158, 11, 0.9);
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 500;
      z-index: 1000;
      backdrop-filter: blur(10px);
      animation: fadeIn 0.3s ease-out;
    `;
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // Add fade animations
  const fadeStyle = document.createElement('style');
  fadeStyle.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(fadeStyle);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Install prompt for PWA
  let deferredPrompt;
  let installButton;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    
    // Show install button
    showInstallButton();
  });

  function showInstallButton() {
    installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.innerHTML = '📱 Install App';
    installButton.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 10px 30px rgba(16, 185, 129, 0.3);
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    
    installButton.addEventListener('mouseenter', () => {
      installButton.style.transform = 'translateY(-2px)';
      installButton.style.boxShadow = '0 15px 35px rgba(16, 185, 129, 0.4)';
    });
    
    installButton.addEventListener('mouseleave', () => {
      installButton.style.transform = 'translateY(0)';
      installButton.style.boxShadow = '0 10px 30px rgba(16, 185, 129, 0.3)';
    });
    
    installButton.addEventListener('click', installApp);
    document.body.appendChild(installButton);
  }

  async function installApp() {
    if (!deferredPrompt) {
      console.log('Install prompt not available');
      return;
    }
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user's response
    const { outcome } = await deferredPrompt.userChoice;
    console.log('User response to install prompt:', outcome);
    
    // Reset the deferred prompt variable
    deferredPrompt = null;
    
    // Hide the install button
    if (installButton) {
      installButton.remove();
      installButton = null;
    }
  }

  // Handle successful installation
  window.addEventListener('appinstalled', () => {
    console.log('PWA installed successfully');
    if (installButton) {
      installButton.remove();
      installButton = null;
    }
  });

  // Expose functions globally
  window.pwa = {
    install: installApp,
    isInstalled: () => window.matchMedia('(display-mode: standalone)').matches,
    requestNotificationPermission
  };

})();