import uvicorn
from config import WEBAPP_HOST, WEBAPP_PORT
if __name__ == '__main__':
    uvicorn.run('webapp.api:app',host=WEBAPP_HOST,port=WEBAPP_PORT,proxy_headers=True,forwarded_allow_ips='*')
