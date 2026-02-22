"""
GeoIP Service for IP Geolocation and Country Blocking

Provides IP-to-country lookup and enforces geographic access restrictions.
Supports MaxMind GeoLite2 database for accurate geolocation.

Zero-Trust Security:
- All IP addresses are logged with country information
- Requests from blocked countries are denied by default
- Explicit exceptions can be granted for specific IPs
"""

import ipaddress
from typing import Optional, Dict, Any, Set
from datetime import datetime, timezone
from pathlib import Path
from loguru import logger

try:
    import geoip2.database
    import geoip2.errors
    GEOIP_AVAILABLE = True
except ImportError:
    GEOIP_AVAILABLE = False
    logger.warning("geoip2 package not installed. GeoIP features will be limited.")


class GeoIPService:
    """
    Service for IP geolocation and country-based access control.

    Uses MaxMind GeoLite2 database for IP-to-country lookup.
    Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data
    """

    # Default list of high-risk countries (ISO 3166-1 alpha-2 codes)
    # These are commonly blocked in security-sensitive applications
    DEFAULT_BLOCKED_COUNTRIES: Set[str] = {
        "KP",  # North Korea
        "IR",  # Iran
        "SY",  # Syria
        "CU",  # Cuba
        "RU",  # Russia
        "BY",  # Belarus
        "CN",  # China (optional - many legitimate users)
    }

    # Private/reserved IP ranges (always allowed)
    PRIVATE_RANGES = [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("fc00::/7"),
        ipaddress.ip_network("fe80::/10"),
    ]

    def __init__(
        self,
        geoip_db_path: Optional[str] = None,
        blocked_countries: Optional[Set[str]] = None,
        enabled: bool = True,
    ):
        """
        Initialize GeoIP service.

        Args:
            geoip_db_path: Path to MaxMind GeoLite2-Country.mmdb file
            blocked_countries: Set of ISO country codes to block
            enabled: Whether geo-blocking is enabled
        """
        self.enabled = enabled
        self.blocked_countries = blocked_countries or set()
        self.geoip_reader = None
        self._ip_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_max_size = 10000

        # Try to load GeoIP database
        if geoip_db_path and GEOIP_AVAILABLE:
            try:
                db_path = Path(geoip_db_path)
                if db_path.exists():
                    self.geoip_reader = geoip2.database.Reader(str(db_path))
                    logger.info(f"GeoIP database loaded: {geoip_db_path}")
                else:
                    logger.warning(f"GeoIP database not found: {geoip_db_path}")
            except Exception as e:
                logger.error(f"Failed to load GeoIP database: {e}")

    def is_private_ip(self, ip_address: str) -> bool:
        """
        Check if IP address is in private/reserved range.

        Private IPs are always allowed (internal network traffic).
        """
        try:
            ip = ipaddress.ip_address(ip_address)
            for network in self.PRIVATE_RANGES:
                if ip in network:
                    return True
            return False
        except ValueError:
            return False

    def lookup_ip(self, ip_address: str) -> Dict[str, Any]:
        """
        Look up geolocation information for an IP address.

        Args:
            ip_address: IPv4 or IPv6 address string

        Returns:
            Dict with country_code, country_name, is_private, etc.
        """
        # Check cache first
        if ip_address in self._ip_cache:
            return self._ip_cache[ip_address]

        result = {
            "ip_address": ip_address,
            "country_code": None,
            "country_name": None,
            "is_private": False,
            "is_blocked": False,
            "lookup_time": datetime.now(timezone.utc).isoformat(),
            "lookup_source": "unknown",
        }

        # Check if private IP
        if self.is_private_ip(ip_address):
            result["is_private"] = True
            result["lookup_source"] = "private_range"
            result["country_code"] = "PRIVATE"
            result["country_name"] = "Private Network"
            self._cache_result(ip_address, result)
            return result

        # Try GeoIP lookup
        if self.geoip_reader:
            try:
                response = self.geoip_reader.country(ip_address)
                result["country_code"] = response.country.iso_code
                result["country_name"] = response.country.name
                result["lookup_source"] = "maxmind_geoip"
            except geoip2.errors.AddressNotFoundError:
                result["lookup_source"] = "not_found"
            except Exception as e:
                logger.warning(f"GeoIP lookup failed for {ip_address}: {e}")
                result["lookup_source"] = "error"
        else:
            result["lookup_source"] = "no_database"

        # Check if blocked
        if result["country_code"] and result["country_code"] in self.blocked_countries:
            result["is_blocked"] = True

        self._cache_result(ip_address, result)
        return result

    def _cache_result(self, ip_address: str, result: Dict[str, Any]) -> None:
        """Cache lookup result with size limit."""
        if len(self._ip_cache) >= self._cache_max_size:
            # Remove oldest entries (simple FIFO)
            keys_to_remove = list(self._ip_cache.keys())[:1000]
            for key in keys_to_remove:
                del self._ip_cache[key]
        self._ip_cache[ip_address] = result

    def is_ip_blocked(
        self,
        ip_address: str,
        allowed_ips: Optional[Set[str]] = None,
    ) -> tuple[bool, str]:
        """
        Check if an IP address should be blocked.

        Args:
            ip_address: IP address to check
            allowed_ips: Set of explicitly allowed IPs (exceptions)

        Returns:
            Tuple of (is_blocked, reason)
        """
        if not self.enabled:
            return False, "geo_blocking_disabled"

        # Check explicit allowlist first
        if allowed_ips and ip_address in allowed_ips:
            return False, "ip_allowlisted"

        # Private IPs are always allowed
        if self.is_private_ip(ip_address):
            return False, "private_ip"

        # Lookup country
        info = self.lookup_ip(ip_address)

        # If we couldn't determine country, allow by default (fail-open)
        # Change to fail-closed for stricter security
        if not info["country_code"]:
            return False, "country_unknown"

        # Check if country is blocked
        if info["is_blocked"]:
            return True, f"blocked_country:{info['country_code']}"

        return False, "allowed"

    def add_blocked_country(self, country_code: str) -> None:
        """Add a country to the blocked list."""
        self.blocked_countries.add(country_code.upper())
        logger.info(f"Added {country_code} to blocked countries")

    def remove_blocked_country(self, country_code: str) -> None:
        """Remove a country from the blocked list."""
        self.blocked_countries.discard(country_code.upper())
        logger.info(f"Removed {country_code} from blocked countries")

    def get_blocked_countries(self) -> Set[str]:
        """Get current list of blocked countries."""
        return self.blocked_countries.copy()

    def clear_cache(self) -> None:
        """Clear the IP lookup cache."""
        self._ip_cache.clear()

    def close(self) -> None:
        """Close the GeoIP database reader."""
        if self.geoip_reader:
            self.geoip_reader.close()


# Global GeoIP service instance (initialized in main.py)
geoip_service: Optional[GeoIPService] = None


def get_geoip_service() -> Optional[GeoIPService]:
    """Get the global GeoIP service instance."""
    return geoip_service


def init_geoip_service(
    geoip_db_path: Optional[str] = None,
    blocked_countries: Optional[Set[str]] = None,
    enabled: bool = True,
) -> GeoIPService:
    """
    Initialize the global GeoIP service.

    Should be called during application startup.
    """
    global geoip_service
    geoip_service = GeoIPService(
        geoip_db_path=geoip_db_path,
        blocked_countries=blocked_countries,
        enabled=enabled,
    )
    return geoip_service
