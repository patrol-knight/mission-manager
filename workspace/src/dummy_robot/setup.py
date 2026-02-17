import os

from glob import glob
from setuptools import find_packages, setup

package_name = 'dummy_robot'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'maps'), glob('maps/*')),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='koko',
    maintainer_email='the21515@gmail.com',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'dummy_pose_tf = dummy_robot.dummy_pose_tf:main',
            'dummy_planner = dummy_robot.dummy_planner:main',
            'astar_planner = dummy_robot.astar_planner:main'
        ],
    },
)
