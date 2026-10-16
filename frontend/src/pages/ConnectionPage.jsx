import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitState,
} from "@reown/appkit/react";

const ConnectionPage = () => {
  const { open, close } = useAppKit();
  const { isConnected, status } = useAppKitAccount();
  const { open: isModalOpen } = useAppKitState();
  const navigate = useNavigate();

  const [initialCheckDone, setInitialCheckDone] = useState(false);

  // Helper to redirect the user based on stored URL or fallback.
  const redirectUser = useCallback(() => {
    const redirectUrl = sessionStorage.getItem("redirectUrl");
    if (redirectUrl) {
      sessionStorage.removeItem("redirectUrl");
      navigate(redirectUrl);
    } else {
      navigate("/");
    }
  }, [navigate]);

  // Initial check: wait until status is not "connecting"/"reconnecting".
  useEffect(() => {
    if (status !== "connecting" && status !== "reconnecting") {
      if (isConnected) {
        redirectUser();
      } else {
        setInitialCheckDone(true);
      }
    }
  }, [status, isConnected, redirectUser]);

  // Timer: every 500ms, if the user is not actively connecting,
  // check if the modal should be open or closed.
  useEffect(() => {
    if (!initialCheckDone) {
      return;
    }

    const interval = setInterval(() => {
      // Skip the checks if the user is in the process of connecting.
      if (status === "connecting" || status === "reconnecting") {
        return;
      }

      if (isConnected) {
        // If connected, ensure the modal is closed and redirect.
        if (isModalOpen) {
          close();
        }

        clearInterval(interval);
        redirectUser();
      } else {
        // Not connected: if the modal isn’t open, open it.
        if (!isModalOpen) {
          open({ view: "Connect" });
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [
    initialCheckDone,
    status,
    isConnected,
    isModalOpen,
    open,
    close,
    redirectUser,
  ]);

  return null;
};

export default ConnectionPage;
