import { Link } from "react-router-dom";
import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";

function NotFound() {
  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="notfound-container">
        {/* 404 Number with Custom Font */}
        <h1 className="notfound-404">404</h1>
        <p className="notfound-text">
          The page you’re looking for doesn’t exist.
        </p>
        <Link to="/" className="a-button-1 notfound-btn">
          &larr; Go to Homepage
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
