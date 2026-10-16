import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import FAQ from "./pages/FAQ.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CreateCampaign from "./pages/CreateCampaign.jsx";
import Profile from "./pages/Profile.jsx";
import EditCampaign from "./pages/EditCampaign.jsx";
import ScrollToTop from "./utils/ScrollToTop.js";
import NotFound from "./pages/404.jsx";
import ConnectionPage from "./pages/ConnectionPage.jsx";
import RequireWallet from "./components/RequireWallet.jsx";
import CookieConsent from "./components/CookieConsent.jsx";
import CookiePolicy from "./pages/CookiePolicy.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import TermsOfService from "./pages/TermsOfService.jsx";

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/connect" element={<ConnectionPage />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/cookies" element={<CookiePolicy />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route element={<RequireWallet />}>
          <Route path="/create-campaign" element={<CreateCampaign />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/edit-campaign" element={<EditCampaign />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <CookieConsent />
    </Router>
  );
}

export default App;
