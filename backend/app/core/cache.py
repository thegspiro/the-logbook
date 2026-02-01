"""
Redis Cache Manager

Provides async Redis connection and caching utilities.
Includes retry logic and graceful degradation for robust startup.
"""

import asyncio
import redis.asyncio as redis
from typing import Optional, Any
import json
from loguru import logger

from app.core.config import settings


class CacheManager:
    """
    Redis cache manager with async support.

    Supports graceful degradation - the application can run without Redis
    if REDIS_REQUIRED is False (default).
    """

    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self._connected: bool = False

    @property
    def redis(self) -> Optional[redis.Redis]:
        """Get Redis client (alias for redis_client)"""
        return self.redis_client

    @property
    def is_connected(self) -> bool:
        """Check if Redis is connected"""
        return self._connected and self.redis_client is not None

    async def connect(self):
        """
        Initialize Redis connection with retry logic.

        Uses exponential backoff for retries. If REDIS_REQUIRED is False,
        the application will continue without Redis (graceful degradation).
        """
        last_exception = None
        retry_delay = 1  # Start with 1 second delay

        for attempt in range(1, settings.REDIS_CONNECT_RETRIES + 1):
            try:
                logger.info(f"Redis connection attempt {attempt}/{settings.REDIS_CONNECT_RETRIES}...")

                # Create Redis client with timeout
                self.redis_client = redis.Redis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=settings.REDIS_CONNECT_TIMEOUT,
                    socket_timeout=settings.REDIS_CONNECT_TIMEOUT,
                )

                # Test connection with timeout
                async with asyncio.timeout(settings.REDIS_CONNECT_TIMEOUT):
                    await self.redis_client.ping()

                self._connected = True
                logger.info("Redis connection established")
                return  # Success - exit the retry loop

            except asyncio.TimeoutError:
                last_exception = TimeoutError(f"Redis connection timed out after {settings.REDIS_CONNECT_TIMEOUT}s")
                logger.warning(f"Redis connection attempt {attempt} timed out")
            except Exception as e:
                last_exception = e
                logger.warning(f"Redis connection attempt {attempt} failed: {e}")

            # Clean up failed client
            if self.redis_client:
                try:
                    await self.redis_client.close()
                except Exception:
                    pass
                self.redis_client = None

            # Wait before retrying (exponential backoff)
            if attempt < settings.REDIS_CONNECT_RETRIES:
                logger.info(f"Retrying in {retry_delay}s...")
                await asyncio.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff

        # All retries exhausted
        self._connected = False
        if settings.REDIS_REQUIRED:
            logger.error(f"Redis connection failed after {settings.REDIS_CONNECT_RETRIES} attempts")
            raise last_exception or ConnectionError("Failed to connect to Redis")
        else:
            logger.warning(f"Redis unavailable after {settings.REDIS_CONNECT_RETRIES} attempts - running in degraded mode")
            logger.warning("Caching will be disabled. Set REDIS_REQUIRED=true to enforce Redis connection.")
    
    async def disconnect(self):
        """Close Redis connection"""
        if self.redis_client:
            try:
                await self.redis_client.close()
                logger.info("Redis connection closed")
            except Exception as e:
                logger.warning(f"Error closing Redis connection: {e}")
            finally:
                self.redis_client = None
                self._connected = False
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        if not self.redis_client:
            return None
        
        try:
            value = await self.redis_client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> bool:
        """
        Set value in cache
        
        Args:
            key: Cache key
            value: Value to cache (will be JSON encoded)
            ttl: Time to live in seconds (default: settings.REDIS_TTL)
        """
        if not self.redis_client:
            return False
        
        try:
            ttl = ttl or settings.REDIS_TTL
            serialized = json.dumps(value)
            await self.redis_client.setex(key, ttl, serialized)
            return True
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache"""
        if not self.redis_client:
            return False
        
        try:
            await self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Cache delete error: {e}")
            return False
    
    async def clear_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching pattern
        
        Args:
            pattern: Redis key pattern (e.g., "user:*")
        
        Returns:
            Number of keys deleted
        """
        if not self.redis_client:
            return 0
        
        try:
            keys = []
            async for key in self.redis_client.scan_iter(match=pattern):
                keys.append(key)
            
            if keys:
                return await self.redis_client.delete(*keys)
            return 0
        except Exception as e:
            logger.error(f"Cache clear pattern error: {e}")
            return 0
    
    async def exists(self, key: str) -> bool:
        """Check if key exists"""
        if not self.redis_client:
            return False
        
        try:
            return await self.redis_client.exists(key) > 0
        except Exception as e:
            logger.error(f"Cache exists error: {e}")
            return False


# Global cache manager instance
cache_manager = CacheManager()
