from unittest.mock import AsyncMock, patch

from app.config import settings


async def test_health_checks_database_and_redis(client):
    response = await client.get('/api/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok', 'version': settings.app_version}

    with patch('app.main.redis_client.ping', new=AsyncMock(side_effect=ConnectionError('redis offline'))):
        response = await client.get('/api/health')
    assert response.status_code == 503
    assert response.json() == {'status': 'unavailable', 'version': settings.app_version}
