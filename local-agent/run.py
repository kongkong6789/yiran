from liangce_agent.app import create_app
from liangce_agent import config

app = create_app()

if __name__ == "__main__":
    print(f"数据目录: {config.DATA_DIR}")
    print(f"访问地址: http://{config.HOST}:{config.PORT}")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
