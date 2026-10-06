FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir 'fastapi>=0.115,<1' 'uvicorn>=0.34,<1' 'psycopg[binary]>=3.2,<4'
COPY demo-app/main.py /app/main.py
USER 10001:10001
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
