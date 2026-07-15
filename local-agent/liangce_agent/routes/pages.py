from __future__ import annotations

from flask import Blueprint, redirect, render_template, url_for

from .. import config
from .auth import current_user

pages = Blueprint("pages", __name__)


@pages.get("/")
def index():
    if current_user():
        return redirect(url_for("pages.app"))
    return redirect(url_for("pages.login"))


@pages.get("/login")
def login():
    if current_user():
        return redirect(url_for("pages.app"))
    return render_template(
        "login.html",
        wechat_enabled=bool(config.WECHAT_APP_ID),
        allow_dev_login=config.ALLOW_DEV_LOGIN,
        data_dir=str(config.DATA_DIR),
    )


@pages.get("/app")
def app():
    if not current_user():
        return redirect(url_for("pages.login"))
    return render_template("app.html", data_dir=str(config.DATA_DIR))
