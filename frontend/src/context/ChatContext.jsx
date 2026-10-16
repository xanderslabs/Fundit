import { createContext, useContext, useEffect } from "react";
import PropTypes from "prop-types";

// Create the context
const ChatContext = createContext();

// Main provider component
export function ChatProvider({ children }) {
  useEffect(() => {
    // Avoid declaring unused variables by using window directly
    window.Tawk_LoadStart = new Date();

    // Create and add the script
    const s1 = document.createElement("script");
    const s0 = document.querySelectorAll("script")[0];
    s1.async = true;
    s1.src = "https://embed.tawk.to/67bfa3b864665b190a4fb985/1il29f2v8";
    s1.charset = "UTF-8";
    s1.setAttribute("crossorigin", "*");
    s0.parentNode.insertBefore(s1, s0);

    // Define chat control functions
    const showChat = () => {
      if (window.Tawk_API && window.Tawk_API.maximize) {
        window.Tawk_API.maximize();
      }
    };

    const hideChat = () => {
      if (window.Tawk_API && window.Tawk_API.hideWidget) {
        window.Tawk_API.hideWidget();
      }
    };

    // Store functions on the window object for access
    if (window.Tawk_API) {
      window.Tawk_API.customFunctions = { showChat, hideChat };
    } else {
      window.Tawk_API = { customFunctions: { showChat, hideChat } };
    }
  }, []);

  // Context value with chat control methods
  const contextValue = {
    showChat() {
      if (window.Tawk_API?.maximize) {
        window.Tawk_API.maximize();
      } else if (window.Tawk_API?.customFunctions?.showChat) {
        window.Tawk_API.customFunctions.showChat();
      }
    },
    hideChat() {
      if (window.Tawk_API?.hideWidget) {
        window.Tawk_API.hideWidget();
      } else if (window.Tawk_API?.customFunctions?.hideChat) {
        window.Tawk_API.customFunctions.hideChat();
      }
    },
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}

// Define prop types for the provider
ChatProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

// Create a separate file for the hook (hooks.js)
// export const useChat = () => useContext(ChatContext);

// Instead, export the hook directly here (not ideal for Fast Refresh, but works)
// eslint-disable-next-line react-refresh/only-export-components
export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }

  return context;
}
