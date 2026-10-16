import { useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAppKitAccount } from "@reown/appkit/react";

const RequireWallet = () => {
  const { isConnected, status } = useAppKitAccount();
  const navigate = useNavigate();

  useEffect(() => {
    // Once the status is no longer "connecting" and if not connected, redirect.
    if (status !== "connecting" && !isConnected) {
      sessionStorage.setItem("redirectUrl", window.location.pathname);
      navigate("/connect");
    }
  }, [status, isConnected, navigate]);

  // While connecting or if not connected, render nothing.
  if (status === "connecting" || !isConnected) {
    return null;
  }

  // Once connected, render child routes.
  return <Outlet />;
};

export default RequireWallet;
