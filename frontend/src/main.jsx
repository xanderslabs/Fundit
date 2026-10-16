import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AppKitProvider } from "./config/web3.jsx";
import { ChatProvider } from "./context/ChatContext.jsx";

ReactDOM.createRoot(document.querySelector("#root")).render(
  <React.StrictMode>
    <AppKitProvider>
      <ChatProvider>
        <App />
      </ChatProvider>
    </AppKitProvider>
  </React.StrictMode>,
);
